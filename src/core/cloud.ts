/**
 * Cloud save + leaderboards, local-first (docs/backend.md §5, §7).
 * The game never waits on this module: every network failure degrades to 'offline' and a retry later.
 * Sync = pull (3-way merge against the last agreed snapshot) then push (compare-and-swap on revision).
 */
import {
  LIMITS,
  SCORING_VERSION,
  checkRun,
  formatRecoveryCode,
  normalizeRecoveryCode,
  sanitizeName,
  type AuthResponse,
  type BoardKey,
  type BoardResponse,
  type CreatePlayerResponse,
  type Period,
  type MeResponse,
  type PutSaveRequest,
  type PutSaveResponse,
  type RecoveryCodeRequest,
  type RecoveryCodeResponse,
  type SaveConflictBody,
  type SaveDoc,
  type SaveResponse,
  type StartRunResponse,
  type SubmitRunRequest,
  type SubmitRunResponse,
} from '../../shared/api';
import type { RunStats } from '../screens/results';
import { API_OFF, ApiError, DEVICE, api } from './api';
import { merge } from './merge';
import { storage } from './storage';
import { freshSave, store } from './store';

/**
 * off      no backend configured (VITE_API_BASE=off): all cloud UI hidden
 * disabled the player turned cloud save off (or the account was banned); boards still readable
 * signedOut this device's session was revoked (e.g. another device rotated the code with "sign out other devices");
 *           local progress is kept, nothing syncs until the player re-enters a code or starts a new cloud save
 * pending  something is waiting to go up (deferred push, queued runs, nothing to sync yet)
 */
export type CloudStatus = 'off' | 'disabled' | 'signedOut' | 'offline' | 'syncing' | 'pending' | 'synced' | 'error';
export interface RunHandle {
  /** doubles as the clientRunId idempotency key */
  id: string;
  board: BoardKey;
  /** performance.now() at run start (monotonic: immune to wall-clock changes) */
  startedAt: number;
}

interface QueuedRun {
  req: SubmitRunRequest;
  firstAt: number;
  tries: number;
}

interface CloudState {
  auth: { playerId: string; token: string; tag: string } | null;
  /** server revision that `base` corresponds to (0 = nothing on the server) */
  rev: number;
  /** last snapshot both sides agreed on (null → freshSave() is the base) */
  base: SaveDoc | null;
  /** last successful sync (UI "synced at …") */
  syncedAt: number;
  /** cached transfer code (XXXX-XXXX-XXXX) + the server's recovery_created_at it belongs to */
  recovery: { code: string; createdAt: number } | null;
  /** the PUT whose reply we may not have seen; resolved against SaveResponse.pushIds (B1) */
  inflight: { id: string; baseRev: number; doc: SaveDoc } | null;
  /** cloud save switched off by the player (delete account) or by a ban: nothing talks to the server */
  disabled: boolean;
  /** the server revoked this device's session: no sync, tickets or submits until a restore or `enable()` */
  signedOut: boolean;
  /** the one-time "signed out" modal was already shown for this sign-out */
  signedOutSeen: boolean;
  /** the account this device was signed out of, with its sync point, so restoring that same account merges against
   * the real base instead of "combining" against nothing (which would double every additive field) */
  prev: { playerId: string; rev: number; base: SaveDoc | null; inflight: CloudState['inflight'] } | null;
  /** offline run submissions, FIFO */
  queue: QueuedRun[];
  /** merged result about to be applied to the store (crash safety, §5.4) */
  pendingMerged: SaveDoc | null;
}

const KEY = 'hanzi-rush:cloud:v1';
const DEBOUNCE_MS = 15_000;
const PUT_GAP_MS = LIMITS.saveMinIntervalSec * 1000 + 500;
const BACKOFF_MIN = 15_000;
const BACKOFF_MAX = 300_000;
const PULL_AFTER_HIDDEN_MS = 5 * 60_000;
const TICKET_WAIT_MS = 3000;
/** safety net: a run that never ended can't hold off merges forever */
const RUN_ACTIVE_MAX_MS = 30 * 60_000;

const blank = (): CloudState => ({ auth: null, rev: 0, base: null, syncedAt: 0, recovery: null, inflight: null, disabled: false, signedOut: false, signedOutSeen: false, prev: null, queue: [], pendingMerged: null });

function load(): CloudState {
  try {
    const raw = storage.get(KEY);
    if (raw) {
      const s = { ...blank(), ...JSON.parse(raw) };
      delete s.recoveryCode; // pre-validation cache format: the code can't be trusted without a createdAt
      return s;
    }
  } catch {
    /* corrupt state: start clean, local progress is untouched */
  }
  return blank();
}

let st: CloudState = blank();
let status: CloudStatus = API_OFF ? 'off' : 'offline';
let inited = false;
/** true while store.replaceAll() runs, so our own writes don't schedule another sync */
let applying = false;
const listeners = { status: new Set<() => void>(), applied: new Set<() => void>() };
const emit = (ev: 'status' | 'applied') => listeners[ev].forEach((f) => f());

const persist = () => storage.set(KEY, JSON.stringify(st));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function setStatus(s: CloudStatus) {
  if (status === s || API_OFF) return;
  status = s;
  emit('status');
}

const uuid = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 3) | 8).toString(16);
      });

// ------------------------------------------------------------------ timers & single flight
let debounceTimer = 0;
let retryTimer = 0;
let retryDelay = BACKOFF_MIN;
let lastPutAt = 0;
let wantKeepalive = false;

/** one sync at a time: a promise chain, with queued requests coalesced into one */
let chain: Promise<unknown> = Promise.resolve();
let queued: Promise<void> | null = null;
let wantPull = false;

function sync(pull = false): Promise<void> {
  if (API_OFF) return Promise.resolve();
  wantPull ||= pull;
  if (queued) return queued;
  const p = chain.then(() => {
    queued = null;
    const doPull = wantPull;
    wantPull = false;
    return doSync(doPull);
  });
  queued = p;
  chain = p.catch(() => {});
  return p;
}

/** run `fn` after any in-flight sync and before the next one */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn);
  chain = p.catch(() => {});
  return p;
}

function scheduleSync(ms: number) {
  clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => sync(false), ms);
}

/** exponential backoff: 15 s, 30 s, 60 s … 5 min */
function scheduleRetry() {
  scheduleSync(retryDelay);
  retryDelay = Math.min(retryDelay * 2, BACKOFF_MAX);
}

function markDirty() {
  if (debounceTimer) return;
  debounceTimer = window.setTimeout(() => {
    debounceTimer = 0;
    sync(false);
  }, DEBOUNCE_MS);
}

// ------------------------------------------------------------------ account
let accountP: Promise<void> | null = null;

/** create the anonymous guest if we don't have one; resolves either way, check `st.auth` */
function ensureAccount(): Promise<void> {
  if (st.auth || st.disabled || st.signedOut) return Promise.resolve();
  return (accountP ??= (async () => {
    try {
      const r = await api<CreatePlayerResponse>('POST', '/players', { body: { device: DEVICE } });
      st.auth = { playerId: r.playerId, token: r.token, tag: r.tag };
      st.rev = 0;
      st.base = null;
      st.inflight = null;
      st.recovery = null;
      persist();
      emit('status');
    } finally {
      accountP = null;
    }
    // errors propagate (e.g. a 429 with Retry-After) to the caller, whose fail() schedules the retry
  })());
}

/**
 * the token is no longer accepted: confirm with GET /me, then go 'signedOut'. Local progress is kept and no
 * replacement guest is minted (that would silently fork the player off their account); the player decides.
 */
async function handle401() {
  if (!st.auth) return;
  const token = st.auth?.token;
  try {
    await api('GET', '/me', { token });
    scheduleRetry(); // the 401 was a blip
    return;
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) return fail(e);
  }
  if (st.auth?.token !== token) return; // already replaced (e.g. a restore finished meanwhile)
  goSignedOut();
}

function goSignedOut() {
  clearTimeout(debounceTimer);
  clearTimeout(retryTimer);
  debounceTimer = 0;
  pendingServer = null;
  const prev = st.auth ? { playerId: st.auth.playerId, rev: st.rev, base: st.base, inflight: st.inflight } : st.prev;
  st = { ...blank(), signedOut: true, prev, queue: st.queue };
  persist();
  setStatus('signedOut');
  emit('status');
}

/** cloud save off: forget the account, keep local progress. `disabled` survives reloads. */
function goDisabled() {
  clearTimeout(debounceTimer);
  clearTimeout(retryTimer);
  debounceTimer = 0;
  st = { ...blank(), disabled: true };
  persist();
  setStatus('disabled');
  emit('status');
}

function fail(e: unknown) {
  if (e instanceof ApiError) {
    if (e.code === 'banned') {
      goDisabled(); // never mint a replacement guest for a banned device
      return;
    }
    if (e.status === 401) {
      void handle401();
      return;
    }
    if (e.status === 429) {
      scheduleSync((e.retryAfter ?? 10) * 1000 + 500);
      setStatus(st.syncedAt ? 'synced' : 'offline');
      return;
    }
    if (e.transient) {
      setStatus('offline');
      scheduleRetry();
      return;
    }
  }
  console.warn('[cloud]', e);
  setStatus('error');
}

// ------------------------------------------------------------------ run guard
let runActive = false;
let runActiveAt = 0;
/** newer server copy that arrived mid-run; applied once the run is over */
let pendingServer: SaveResponse | null = null;
const isRunActive = () => runActive && Date.now() - runActiveAt < RUN_ACTIVE_MAX_MS;

function endRun() {
  runActive = false;
  if (st.signedOut && !st.signedOutSeen) emit('status'); // the "signed out" modal may have been waiting for the run to end
  if (pendingServer) {
    pendingServer = null;
    sync(true);
  }
}

// ------------------------------------------------------------------ merge & apply
const baseJson = (() => {
  let ref: SaveDoc | null = null;
  let json: string | null = null;
  return () => {
    if (st.base !== ref) {
      ref = st.base;
      json = st.base ? JSON.stringify(st.base) : null;
    }
    return json;
  };
})();

function applyMerged(M: SaveDoc, S: SaveResponse | null, local: SaveDoc) {
  // persist the new base + the result first; if we die before the store write, boot re-applies it (§5.4)
  if (S) {
    st.base = S.data;
    st.rev = S.revision;
  }
  st.pendingMerged = M;
  persist();
  applying = true;
  try {
    store.replaceAll(M);
  } finally {
    applying = false;
  }
  st.pendingMerged = null;
  persist();
  if (!same(M, local)) emit('applied');
}

/**
 * Resolve a possibly-lost PUT against what the server says (B1). Without this a push whose 200 never reached us
 * would be merged back into our own data on the next pull, double-counting additive fields (coins, stats…).
 *  - our push id is in S.pushIds: it landed, so what we sent IS the new merge base
 *  - the server moved past the revision we pushed from without our id: it did not land (or aged out); forget it
 */
function reconcile(S: SaveResponse) {
  const f = st.inflight;
  if (!f) return;
  if (S.pushIds?.includes(f.id)) {
    st.base = f.doc;
    st.inflight = null;
    persist();
  } else if (S.revision > f.baseRev) {
    st.inflight = null;
    persist();
  }
}

/** merge a newer server copy into the store. false = deferred because a run is in progress */
function applyServer(S: SaveResponse): boolean {
  if (!S?.data?.progress) throw new ApiError(200, 'bad_request', null, 'malformed save');
  reconcile(S);
  if (isRunActive()) {
    pendingServer = S;
    return false;
  }
  const local = store.snapshot();
  applyMerged(merge(st.base ?? freshSave(), local, S.data), S, local);
  return true;
}

// ------------------------------------------------------------------ sync phases
/** nothing worth creating an account for yet: no games, no pulls */
const isFresh = (d: SaveDoc) => d.progress.stats.games === 0 && d.progress.stats.pulls === 0;

async function doSync(pull: boolean) {
  if (API_OFF || st.disabled || st.signedOut) return;
  const urgent = wantKeepalive; // the page is being hidden: the save goes first, runs after
  if (!st.auth && !st.queue.length && isFresh(store.snapshot())) {
    // a first-time visitor who hasn't played: don't mint a guest account per bounce
    setStatus('pending');
    wantKeepalive = false;
    return;
  }
  setStatus('syncing');
  try {
    if (!st.auth) {
      await ensureAccount();
      if (!st.auth) throw new ApiError(0, 'offline');
    }
    let blocked = urgent ? false : await drainQueue();
    // an unresolved push must be reconciled against the server before anything else is pushed
    if ((pull || st.rev === 0 || st.inflight) && !(await pullPhase())) {
      if (blocked) scheduleRetry();
      setStatus('pending');
      return;
    }
    const pushed = await pushPhase();
    if (urgent) blocked = await drainQueue();
    if (blocked) scheduleRetry();
    else retryDelay = BACKOFF_MIN;
    setStatus(pushed && !blocked ? 'synced' : 'pending');
  } catch (e) {
    fail(e);
  } finally {
    wantKeepalive = false;
  }
}

const SAVE_OPTS = { timeoutMs: LIMITS.saveTimeoutMs } as const;

/** returns true when it is fine to push afterwards */
async function pullPhase(): Promise<boolean> {
  let S: SaveResponse;
  try {
    S = await api<SaveResponse>('GET', '/save', { token: st.auth!.token, ...SAVE_OPTS });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      // the server has nothing (never uploaded, or it was wiped): push from revision 0
      st.rev = 0;
      st.base = null;
      st.inflight = null;
      persist();
      return true;
    }
    throw e;
  }
  reconcile(S);
  if (S.revision === st.rev) return true;
  return applyServer(S);
}

/** true = the server has our state; false = deferred (run in progress / save-interval wait) */
async function pushPhase(): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = store.snapshot();
    const json = JSON.stringify(doc);
    if (st.rev > 0 && json === baseJson()) {
      st.syncedAt = Date.now();
      persist();
      return true;
    }
    const wait = PUT_GAP_MS - (Date.now() - lastPutAt);
    if (wait > 0) {
      scheduleSync(wait);
      return false;
    }
    lastPutAt = Date.now();
    const keepalive = wantKeepalive && new TextEncoder().encode(json).length <= LIMITS.keepaliveMaxBytes;
    wantKeepalive = false;
    // written BEFORE the request: if the reply is lost, the next sync finds this and reconciles via pushIds
    const inflight = { id: uuid(), baseRev: st.rev, doc };
    st.inflight = inflight;
    persist();
    const body: PutSaveRequest = { baseRevision: st.rev, data: doc, clientUpdatedAt: Date.now(), pushId: inflight.id };
    try {
      const res = await api<PutSaveResponse>('PUT', '/save', { token: st.auth!.token, body, keepalive, ...SAVE_OPTS });
      st.base = doc;
      st.rev = res.revision;
      st.inflight = null;
      st.syncedAt = Date.now();
      persist();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const cur = (e.body as SaveConflictBody | null)?.current;
        if (!cur) {
          // the row is gone on the server: start over from revision 0 (same as a 404 on pull)
          st.rev = 0;
          st.base = null;
          st.inflight = null;
          persist();
          continue;
        }
        if (!applyServer(cur)) return false; // mid-run: stashed, retried after the run
        continue;
      }
      throw e;
    }
  }
  return false;
}

// ------------------------------------------------------------------ run tickets & submissions
const runs = new Map<string, { handle: RunHandle; ticket: Promise<string | null> }>();

async function requestTicket(board: BoardKey): Promise<string | null> {
  try {
    if (!st.auth) await ensureAccount(); // someone who starts a run is worth an account (and a verified rank)
    if (!st.auth) return null;
    return (await api<StartRunResponse>('POST', '/runs/start', { body: { board }, token: st.auth.token })).ticket;
  } catch {
    return null; // runs work without a ticket, they just rank as unverified
  }
}

type PostResult = { kind: 'ok'; res: SubmitRunResponse } | { kind: 'drop' } | { kind: 'retry'; err: ApiError };

async function postRun(req: SubmitRunRequest): Promise<PostResult> {
  try {
    return { kind: 'ok', res: await api<SubmitRunResponse>('POST', '/runs', { body: req, token: st.auth!.token }) };
  } catch (e) {
    if (!(e instanceof ApiError)) return { kind: 'drop' };
    // an expired/foreign ticket: still worth ranking, as an unverified run
    if (e.code === 'ticket_invalid' && req.ticket) return postRun({ ...req, ticket: null });
    if (e.code === 'banned') {
      fail(e);
      return { kind: 'drop' };
    }
    if (e.transient || e.status === 401) return { kind: 'retry', err: e };
    console.warn('[cloud] run rejected', e.code, e.body?.error.reason ?? '');
    return { kind: 'drop' };
  }
}

function enqueue(req: SubmitRunRequest) {
  st.queue.push({ req, firstAt: Date.now(), tries: 0 });
  while (st.queue.length > LIMITS.queueMax) st.queue.shift();
  persist();
}

/**
 * FIFO; stops at the first run that still can't be delivered. Never throws for a stuck run (it must not block the
 * save sync) except on 401, which has to reach handle401. Returns true when runs are still waiting.
 */
async function drainQueue(): Promise<boolean> {
  const cutoff = Date.now() - LIMITS.queueMaxAgeMs;
  st.queue = st.queue.filter((q) => q.firstAt >= cutoff && q.tries <= LIMITS.queueMaxTries);
  while (st.queue.length && st.auth) {
    const q = st.queue[0];
    const r = await postRun(q.req);
    if (r.kind === 'retry') {
      const e = r.err;
      if (e.status === 401) throw e;
      if (e.status === 429 && (e.retryAfter ?? 0) > LIMITS.queueDropRetryAfterSec) {
        // the daily unverified cap: waiting won't help today, and it would block everything behind it
        st.queue.shift();
        persist();
        continue;
      }
      if (e.status !== 0) q.tries++; // being offline is not the run's fault
      if (q.tries > LIMITS.queueMaxTries) {
        st.queue.shift();
        persist();
        continue;
      }
      persist();
      return true;
    }
    st.queue.shift();
    persist();
  }
  return st.queue.length > 0;
}

// ------------------------------------------------------------------ public surface
const isEmpty = (d: SaveDoc) => d.progress.stats.games === 0 && d.progress.stats.pulls === 0 && d.progress.xp === 0;

export const cloud = {
  init() {
    if (API_OFF || inited) return;
    inited = true;
    st = load();
    status = st.disabled ? 'disabled' : st.signedOut ? 'signedOut' : st.syncedAt ? 'synced' : 'offline';
    if (st.pendingMerged) {
      // interrupted between "persist cloud state" and "write store": finish the job
      const M = st.pendingMerged;
      const local = store.snapshot();
      applyMerged(M, null, local);
    }
    store.onSave(() => {
      if (!applying) markDirty();
    });
    addEventListener('online', () => {
      retryDelay = BACKOFF_MIN;
      sync(true);
    });
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        wantKeepalive = true; // doSync pushes the save first (keepalive when it fits), runs after
        sync(false);
      } else if (hiddenAt && Date.now() - hiddenAt > PULL_AFTER_HIDDEN_MS) {
        sync(true);
      }
    });
    sync(true);
  },

  get status(): CloudStatus {
    return status;
  },
  get syncedAt() {
    return st.syncedAt;
  },
  get tag(): string | null {
    return st.auth?.tag ?? null;
  },
  /** cloud save was switched off (account deleted / banned); `enable()` turns it back on */
  get disabled() {
    return st.disabled;
  },

  /** the session was revoked: the player has not yet been told */
  get signedOutPending() {
    return st.signedOut && !st.signedOutSeen;
  },
  /** a run is on screen (UI that interrupts should wait) */
  get runActive() {
    return isRunActive();
  },
  markSignedOutSeen() {
    if (!st.signedOut || st.signedOutSeen) return;
    st.signedOutSeen = true;
    persist();
  },

  /** turn cloud save back on after it was switched off, or start a NEW cloud save after being signed out (new guest, local progress uploaded) */
  enable(): Promise<void> {
    if (API_OFF) return Promise.resolve();
    st.disabled = false;
    st.signedOut = false;
    st.signedOutSeen = false;
    persist();
    setStatus('offline');
    emit('status');
    return sync(true);
  },

  on(ev: 'status' | 'applied', cb: () => void) {
    listeners[ev].add(cb);
    return () => listeners[ev].delete(cb);
  },

  /** push now (the server's 10 s save interval is respected) */
  flush(opts?: { keepalive?: boolean }): Promise<void> {
    wantKeepalive = !!opts?.keepalive;
    return sync(false);
  },

  startRun(board: BoardKey): RunHandle {
    const handle: RunHandle = { id: uuid(), board, startedAt: performance.now() };
    runActive = true;
    runActiveAt = Date.now();
    if (!API_OFF && !st.disabled && !st.signedOut) {
      runs.set(handle.id, { handle, ticket: requestTicket(board) });
      for (const [id, r] of runs) if (handle.startedAt - r.handle.startedAt > LIMITS.ticketTtlMs) runs.delete(id);
    }
    return handle;
  },

  /** the handle for a RunStats.runId (RunStats itself stays serializable) */
  handle(id: string | undefined): RunHandle | undefined {
    return id ? runs.get(id)?.handle : undefined;
  },

  /** the run screen is gone (finished or quit): merges of pulled data may resume */
  endRun,

  /** resolves with the ranks, or null when the run was queued / rejected / cloud is off */
  async submitRun(h: RunHandle, r: RunStats): Promise<SubmitRunResponse | null> {
    endRun();
    if (API_OFF || st.disabled || st.signedOut) return null;
    const rec = runs.get(h.id);
    runs.delete(h.id);
    let ticket: string | null = null;
    if (rec) ticket = await Promise.race([rec.ticket, new Promise<null>((res) => setTimeout(() => res(null), TICKET_WAIT_MS))]);
    const req: SubmitRunRequest = {
      clientRunId: h.id,
      ticket,
      board: h.board,
      score: r.score,
      correct: r.correct,
      asked: r.asked,
      maxCombo: r.maxCombo,
      durationMs: r.durationMs ?? Math.round(performance.now() - h.startedAt),
      playedAt: Date.now(),
      scoring: SCORING_VERSION,
      profile: { name: sanitizeName(store.progress.profile.name), title: store.progress.profile.title },
    };
    const bad = checkRun(req, ticket !== null);
    if (bad) {
      console.warn('[cloud] run not submitted, implausible:', bad);
      return null;
    }
    if (!st.auth) {
      enqueue(req);
      sync(false);
      return null;
    }
    const out = await postRun(req);
    if (out.kind === 'ok') return out.res;
    if (out.kind === 'retry') {
      enqueue(req);
      fail(out.err); // 401 → handle401, 429 → its Retry-After, otherwise offline + backoff
    }
    return null;
  },

  /** throws ApiError (status 0 = offline) */
  async board(board: BoardKey, period: Period, limit: number = LIMITS.boardDefault): Promise<BoardResponse> {
    const path = `/boards/${board}?period=${period}&limit=${limit}`;
    try {
      return await api<BoardResponse>('GET', path, { token: st.auth?.token });
    } catch (e) {
      // a stale token must not hide the public board
      if (e instanceof ApiError && e.status === 401 && st.auth) return api<BoardResponse>('GET', path);
      throw e;
    }
  },

  /**
   * What the transfer-code modal may show. The cached code is only trusted while GET /me still reports the same
   * recoveryCreatedAt, so a code rotated on another device is never shown as if it worked.
   *   ok       `code` is current
   *   none     the account has no code yet (safe to create one)
   *   replaced we had a code and another device has since made a new one (ours no longer works)
   *   unknown  a code exists but this device never saw it; making a new one is the only way to read one
   */
  async recoveryState(): Promise<{ state: 'ok'; code: string } | { state: 'none' | 'replaced' | 'unknown' }> {
    if (!st.auth) return { state: 'none' };
    const me = await api<MeResponse>('GET', '/me', { token: st.auth.token });
    if (!me.hasRecoveryCode) {
      st.recovery = null;
      persist();
      return { state: 'none' };
    }
    if (st.recovery && st.recovery.createdAt === me.recoveryCreatedAt) return { state: 'ok', code: st.recovery.code };
    const had = !!st.recovery;
    st.recovery = null;
    persist();
    return { state: had ? 'replaced' : 'unknown' };
  },

  /** POST /me/recovery-code: always makes a NEW code (the previous one stops working). */
  async newRecoveryCode(signOutOthers = false): Promise<string> {
    if (!st.auth) await ensureAccount();
    if (!st.auth) throw new ApiError(0, 'offline');
    const body: RecoveryCodeRequest = signOutOthers ? { signOutOthers: true } : {};
    const r = await api<RecoveryCodeResponse>('POST', '/me/recovery-code', { body, token: st.auth.token });
    const code = r.code.includes('-') ? r.code : formatRecoveryCode(r.code);
    st.recovery = { code, createdAt: r.createdAt };
    persist();
    return code;
  },

  /**
   * Log this device into an existing account and bring its save over. `choose` is asked (outside the sync chain)
   * only when this device has its own progress to reconcile with a different account's save.
   */
  async recover(code: string, choose: () => Promise<'combine' | 'cloud' | 'cancel'>): Promise<'ok' | 'invalid' | 'offline' | 'rate_limited' | 'cancelled'> {
    const norm = normalizeRecoveryCode(code);
    if (!norm) return 'invalid';
    let auth: AuthResponse;
    try {
      auth = await api<AuthResponse>('POST', '/recover', { body: { code: norm, device: DEVICE } });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 400 || e.status === 401) return 'invalid';
        if (e.status === 429) return 'rate_limited';
      }
      return 'offline';
    }
    let S: SaveResponse | null = null;
    try {
      S = await api<SaveResponse>('GET', '/save', { token: auth.token, ...SAVE_OPTS });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) return 'offline';
    }
    const sameAccount = (st.auth?.playerId ?? st.prev?.playerId) === auth.playerId;
    // ask before taking the sync chain: a modal left open must not stall syncing
    let pick: 'combine' | 'cloud' = 'cloud';
    if (S && !sameAccount && !isEmpty(store.snapshot())) {
      try {
        const c = await choose();
        if (c === 'cancel') return 'cancelled';
        pick = c;
      } catch {
        return 'cancelled';
      }
    }
    return exclusive(async () => {
      const local = store.snapshot();
      st.disabled = false;
      st.signedOut = false;
      st.signedOutSeen = false;
      st.prev = null;
      st.recovery = auth.recoveryCreatedAt != null ? { code: formatRecoveryCode(norm), createdAt: auth.recoveryCreatedAt } : null;
      if (sameAccount) {
        // already this account (e.g. its own code typed in, or signed out of it): the normal 3-way merge, never a
        // second "combine" against a base of nothing, which would double every additive field
        if (!st.auth && st.prev) ({ rev: st.rev, base: st.base, inflight: st.inflight } = st.prev);
        st.auth = { playerId: auth.playerId, token: auth.token, tag: auth.tag };
        if (S) {
          reconcile(S);
          applyMerged(merge(st.base ?? freshSave(), local, S.data), S, local);
        } else {
          st.rev = 0;
          st.base = null;
          st.inflight = null;
          persist();
        }
      } else {
        // from here on this device belongs to the restored account; the old guest is orphaned
        st.auth = { playerId: auth.playerId, token: auth.token, tag: auth.tag };
        st.inflight = null;
        st.rev = S ? S.revision : 0;
        st.base = S ? S.data : null;
        if (S) applyMerged(isEmpty(local) || pick === 'cloud' ? S.data : merge(freshSave(), local, S.data), S, local);
        else persist();
      }
      setStatus('offline');
      emit('status');
      sync(false); // pushes whatever differs from the server copy
      return 'ok' as const;
    });
  },

  /** DELETE /me, then forget the account and keep cloud save OFF until `enable()`. Local progress stays. */
  deleteAccount(): Promise<void> {
    return exclusive(async () => {
      if (st.auth) {
        try {
          await api('DELETE', '/me', { token: st.auth.token });
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 401)) throw e; // 401: already gone
        }
      }
      goDisabled();
    });
  },
};
