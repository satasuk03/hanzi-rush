/**
 * Jade wallet, client side (docs/cosmetics-shop.md §11). The server owns the balance; this module only caches it so
 * the home chip works offline, claims the one-time starter grant, and sends the daily claim (queued until it lands).
 */
import { bangkokDay, type JadeDailyResponse, type JadeStarterResponse, type WalletResponse } from '../../shared/api';
import { API_OFF, ApiError } from './api';
import { cloud } from './cloud';
import { storage } from './storage';

interface Cache {
  /** the account this cache belongs to (null until we have seen one) */
  playerId: string | null;
  /** last balance the server told us; null = never fetched */
  jade: number | null;
  /** Bangkok day of a daily claim the server has not confirmed yet */
  pendingDay: string | null;
}

const KEY = 'hanzi-rush:wallet:v1';

function load(): Cache {
  try {
    const raw = storage.get(KEY);
    if (raw) return { playerId: null, jade: null, pendingDay: null, ...JSON.parse(raw) };
  } catch {
    /* corrupt cache: refetch */
  }
  return { playerId: null, jade: null, pendingDay: null };
}

let c = load();
let inited = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const persist = () => storage.set(KEY, JSON.stringify(c));
const emit = () => listeners.forEach((f) => f());

/** a different account on this device (restore, new guest) must not inherit the old balance or its queued claim */
function bind() {
  const pid = cloud.playerId;
  if (!pid || pid === c.playerId) return;
  c = c.playerId === null ? { ...c, playerId: pid } : { playerId: pid, jade: null, pendingDay: null };
  persist();
}

function setJade(n: number) {
  bind();
  if (c.jade === n) return;
  c.jade = n;
  persist();
  emit();
}

/** sends the queued daily claim; resolves to the result, or null if it stays queued (offline) or was refused */
async function sendDaily(): Promise<JadeDailyResponse | null> {
  const day = c.pendingDay;
  if (!day) return null;
  try {
    const r = await cloud.authed<JadeDailyResponse>('POST', '/jade/daily', { day });
    bind();
    if (c.pendingDay === day) c.pendingDay = null;
    setJade(r.jade);
    persist();
    return r;
  } catch (e) {
    // transient (offline, 429, 5xx) and 401 keep the claim queued; a hard refusal would only repeat
    if (e instanceof ApiError && !e.transient && e.status !== 401) {
      c.pendingDay = null;
      persist();
    }
    return null;
  }
}

function init() {
  if (inited) return;
  inited = true;
  addEventListener('online', () => void wallet.refresh());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && c.pendingDay) void wallet.refresh();
  });
}

export const wallet = {
  /** cached balance; null until the server has answered once for this account */
  get jade(): number | null {
    return c.jade;
  },
  /** the wallet exists on this build (a backend is configured) */
  get enabled() {
    return !API_OFF;
  },

  on(cb: () => void) {
    init();
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  /** fetch the balance, claim the starter grant once, and flush a queued daily claim. Never throws. */
  refresh(): Promise<void> {
    if (API_OFF) return Promise.resolve();
    return (inflight ??= (async () => {
      try {
        const w = await cloud.authed<WalletResponse>('GET', '/wallet');
        bind();
        setJade(w.jade);
        if (!w.starterClaimed) setJade((await cloud.authed<JadeStarterResponse>('POST', '/jade/starter')).jade);
        if (c.pendingDay) await sendDaily();
      } catch {
        /* offline or signed out: keep showing the cache */
      } finally {
        inflight = null;
      }
    })());
  },

  /**
   * The Jade half of the Daily claim, called right after the coins were paid locally. The day is recorded first so
   * an offline tap is retried later and still counts for the day it was tapped.
   */
  claimDaily(): Promise<JadeDailyResponse | null> {
    if (API_OFF) return Promise.resolve(null);
    init();
    c.pendingDay = bangkokDay(Date.now());
    persist();
    return sendDaily();
  },
};
