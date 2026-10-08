/**
 * Continues: buy back one heart in a rush run (shared/api.ts CONTINUE). The ticket's `runs.continues` is the truth;
 * POST /runs accepts a submitted `continues` up to it.
 *
 * Payment is idempotent per (ticket, n):
 *  - Jade: a 'continue' ledger row with ref `${ticket}:${n}`, in the same batch as the counter bump, which only moves
 *    when that ledger row exists. A replay finds the row and charges nothing.
 *  - Ad (continue 1 only): AdMob's server-side verification callback stores a signed `ad_rewards` row whose
 *    custom_data is the ticket (verifyAdmobSsv). The continue bumps the counter only while an unclaimed row exists
 *    for the ticket, then claims it in the same batch. Nobody but the ticket's player knows the ticket.
 */
import { CONTINUE, LIMITS, bangkokDay, continueCost, type ContinueResponse, type ContinueVia } from '../shared/api';
import { dayStart } from './deals';
import { fail } from './http';
import { applyJade } from './wallet';

const TICKET_RE = /^[A-Za-z0-9_-]{8,64}$/;

interface RunRow {
  player_id: string;
  status: string;
  created_at: number;
  continues: number;
}

export interface ContinueOpts {
  now?: number;
  /** dev only (env ADS_SSV_BYPASS=1): an ad continue needs no AdMob callback */
  trustAds?: boolean;
}

const jadeRef = (ticket: string, n: number) => `${ticket}:${n}`;

export async function continueRun(db: D1Database, playerId: string, ticket: unknown, n: unknown, via: unknown, opts: ContinueOpts = {}): Promise<ContinueResponse> {
  if (typeof ticket !== 'string' || !TICKET_RE.test(ticket)) fail('bad_request', 'Invalid ticket');
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) fail('bad_request', 'Invalid n');
  if (via !== 'ad' && via !== 'jade') fail('bad_request', 'Invalid via');
  const now = opts.now ?? Date.now();

  const run = await db.prepare('SELECT player_id, status, created_at, continues FROM runs WHERE id = ?1').bind(ticket).first<RunRow>();
  if (!run || run.player_id !== playerId) fail('ticket_invalid', 'Ticket is not valid for this run');

  // a replay: answer as the first time, whatever the run's state is now
  if (run.continues >= n) {
    const r = await paidBefore(db, playerId, ticket, n, via);
    if (r) return r;
    fail('continue_refused', 'Continue already used', { reason: 'sequence' });
  }
  if (run.status !== 'open' || now - run.created_at > LIMITS.ticketTtlMs) fail('continue_refused', 'Run is closed', { reason: 'closed' });
  if (n > CONTINUE.max) fail('continue_refused', 'No more continues', { reason: 'max' });
  if (run.continues !== n - 1) fail('continue_refused', 'Not the next continue', { reason: 'sequence' });

  const bump = (guard: string, ...args: unknown[]) =>
    db
      .prepare(`UPDATE runs SET continues = ?3 WHERE id = ?1 AND player_id = ?2 AND status = 'open' AND continues = ?3 - 1 AND ${guard}`)
      .bind(ticket, playerId, n, ...args);

  if (via === 'jade') {
    const cost = continueCost(n);
    const ref = jadeRef(ticket, n);
    const w = await applyJade(db, playerId, -cost, 'continue', ref, now, [
      bump("EXISTS (SELECT 1 FROM jade_ledger WHERE player_id = ?2 AND reason = 'continue' AND ref = ?4)", ref),
    ]);
    if (w.status === 'insufficient') fail('insufficient_jade', 'Not enough Jade', { body: { jade: w.jade } });
    return { n, via, cost: -w.delta, jade: w.jade, replay: w.status === 'replay' };
  }

  if (n !== CONTINUE.adSlot) fail('continue_refused', 'Ads pay the first continue only', { reason: 'ad_slot' });
  const since = dayStart(bangkokDay(now));
  const used = await db.prepare('SELECT COUNT(*) AS c FROM ad_rewards WHERE player_id = ?1 AND claimed_at >= ?2').bind(playerId, since).first<{ c: number }>();
  if ((used?.c ?? 0) >= CONTINUE.adsPerDay) fail('continue_refused', 'Daily ad limit reached', { reason: 'ad_cap' });
  if (opts.trustAds) {
    await db
      .prepare("INSERT INTO ad_rewards (transaction_id, custom_data, ad_unit, verified_at) VALUES (?1, ?2, 'dev', ?3) ON CONFLICT DO NOTHING")
      .bind(`dev:${ticket}`, ticket, now)
      .run();
  }
  const res = await db.batch([
    bump('EXISTS (SELECT 1 FROM ad_rewards WHERE custom_data = ?1 AND player_id IS NULL)'),
    db
      .prepare(
        `UPDATE ad_rewards SET player_id = ?2, claimed_at = ?3
         WHERE transaction_id = (SELECT transaction_id FROM ad_rewards WHERE custom_data = ?1 AND player_id IS NULL ORDER BY verified_at LIMIT 1)
           AND changes() > 0`,
      )
      .bind(ticket, playerId, now),
  ]);
  const jade = (await db.prepare('SELECT jade FROM players WHERE id = ?1').bind(playerId).first<{ jade: number }>())?.jade ?? 0;
  if (res[0].meta.changes > 0) return { n, via, cost: 0, jade, replay: false };
  // lost a race to a twin request, or AdMob has not called back yet
  const r = await paidBefore(db, playerId, ticket, n, via);
  if (r) return r;
  fail('ad_unverified', 'The ad reward is not verified yet');
}

async function paidBefore(db: D1Database, playerId: string, ticket: string, n: number, via: ContinueVia): Promise<ContinueResponse | null> {
  const jade = (await db.prepare('SELECT jade FROM players WHERE id = ?1').bind(playerId).first<{ jade: number }>())?.jade ?? 0;
  if (via === 'jade') {
    const row = await db
      .prepare("SELECT delta FROM jade_ledger WHERE player_id = ?1 AND reason = 'continue' AND ref = ?2")
      .bind(playerId, jadeRef(ticket, n))
      .first<{ delta: number }>();
    return row ? { n, via, cost: -row.delta, jade, replay: true } : null;
  }
  if (n !== CONTINUE.adSlot) return null;
  const row = await db.prepare('SELECT 1 AS x FROM ad_rewards WHERE custom_data = ?1 AND player_id = ?2').bind(ticket, playerId).first();
  return row ? { n, via, cost: 0, jade, replay: true } : null;
}

// ------------------------------------------------------------------ AdMob server-side verification

/** https://developers.google.com/admob/android/ssv: Google's ECDSA P-256 public keys, by key id */
export const ADMOB_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';

export type KeyLookup = (keyId: string) => Promise<CryptoKey | null>;

export interface SsvReward {
  transactionId: string;
  customData: string;
  adUnit: string;
}

const b64urlBytes = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

/** DER `SEQUENCE { INTEGER r, INTEGER s }` → the 64-byte r‖s that WebCrypto verifies. null if malformed. */
export function derToP1363(der: Uint8Array): Uint8Array | null {
  let i = 0;
  const len = () => {
    let l = der[i++];
    if (l & 0x80) {
      const k = l & 0x7f;
      if (k < 1 || k > 2) return -1;
      l = 0;
      for (let j = 0; j < k; j++) l = (l << 8) | der[i++];
    }
    return l;
  };
  if (der[i++] !== 0x30 || len() !== der.length - i) return null;
  const out = new Uint8Array(64);
  for (let part = 0; part < 2; part++) {
    if (der[i++] !== 0x02) return null;
    const l = len();
    if (l < 1 || i + l > der.length) return null;
    let v = der.subarray(i, i + l);
    i += l;
    while (v.length > 32 && v[0] === 0) v = v.subarray(1);
    if (v.length > 32) return null;
    out.set(v, part * 32 + 32 - v.length);
  }
  return i === der.length ? out : null;
}

/**
 * Checks an SSV callback's query string (without the leading '?'). The signed message is everything before
 * `&signature=`; `signature` and `key_id` are the last two parameters. Returns the reward, or null if the callback
 * is not genuine, names an ad unit outside `allowedUnits` (when non-empty), or lacks a transaction id / custom data.
 */
export async function verifyAdmobSsv(query: string, keyFor: KeyLookup, allowedUnits: readonly string[] = []): Promise<SsvReward | null> {
  const cut = query.indexOf('&signature=');
  if (cut < 0) return null;
  const message = query.slice(0, cut);
  const p = new URLSearchParams(query);
  const sig = p.get('signature');
  const keyId = p.get('key_id');
  const transactionId = p.get('transaction_id');
  const customData = p.get('custom_data');
  const adUnit = p.get('ad_unit') ?? '';
  if (!sig || !keyId || !transactionId || !customData) return null;
  if (allowedUnits.length && !allowedUnits.includes(adUnit)) return null;
  const key = await keyFor(keyId);
  if (!key) return null;
  let raw: Uint8Array | null;
  try {
    raw = derToP1363(b64urlBytes(sig));
  } catch {
    return null;
  }
  if (!raw) return null;
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, new TextEncoder().encode(message));
  return ok ? { transactionId, customData, adUnit } : null;
}

let keyCache: { at: number; keys: Map<string, CryptoKey> } | null = null;

/** Google's keys, cached per isolate for a day and refetched once when a key id is unknown (key rotation). */
export const googleKeys: KeyLookup = async (keyId) => {
  const fresh = keyCache && Date.now() - keyCache.at < 86_400_000;
  if (!fresh || !keyCache!.keys.has(keyId)) {
    const res = await fetch(ADMOB_KEYS_URL, { cf: { cacheTtl: 3600 } } as RequestInit);
    if (!res.ok) return keyCache?.keys.get(keyId) ?? null;
    const body = (await res.json()) as { keys: { keyId: number; base64: string }[] };
    const keys = new Map<string, CryptoKey>();
    for (const k of body.keys) {
      keys.set(String(k.keyId), await crypto.subtle.importKey('spki', b64urlBytes(k.base64), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']));
    }
    keyCache = { at: Date.now(), keys };
  }
  return keyCache!.keys.get(keyId) ?? null;
};

/** stores a verified reward once (AdMob retries its callback until it gets a 200) */
export const storeAdReward = (db: D1Database, r: SsvReward, now = Date.now()) =>
  db
    .prepare('INSERT INTO ad_rewards (transaction_id, custom_data, ad_unit, verified_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING')
    .bind(r.transactionId, r.customData, r.adUnit, now)
    .run();
