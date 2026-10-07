/**
 * Jade wallet, client side (docs/cosmetics-shop.md §11). The server owns the balance; this module only caches it so
 * the home chip works offline, claims the one-time starter grant, and sends the daily claim (queued until it lands).
 */
import { bangkokDay, type JadeDailyResponse, type JadeStarterResponse, type ShopPullRequest, type ShopPullResponse, type WalletResponse } from '../../shared/api';
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
  /** item id → copies, as last seen from the server (the Wardrobe and equipping read this offline) */
  inventory: Record<string, number>;
  /** box id → pulls since the last LEGENDARY+ */
  pity: Record<string, number>;
  /** a purchase that may have been charged but whose answer we never saw: re-sent with the same ref until answered */
  pending: PendingPull | null;
  /** owned item ids the player has already looked at in the Wardrobe; null until the first inventory arrives, which
   *  marks everything owned then as seen (device-local, so a new device shows no "new" dots) */
  seen: string[] | null;
}

export interface PendingPull {
  box: string;
  qty: number;
  ref: string;
}

const KEY = 'hanzi-rush:wallet:v1';
const empty = (): Cache => ({ playerId: null, jade: null, pendingDay: null, inventory: {}, pity: {}, pending: null, seen: null });

function load(): Cache {
  try {
    const raw = storage.get(KEY);
    if (raw) return { ...empty(), ...JSON.parse(raw) };
  } catch {
    /* corrupt cache: refetch */
  }
  return empty();
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
  c = c.playerId === null ? { ...c, playerId: pid } : { ...empty(), playerId: pid };
  persist();
}

/** the server's inventory and pity replace the cache (they are authoritative) */
function setHoldings(inventory: Record<string, number>, pity: Record<string, number>) {
  bind();
  c.inventory = inventory;
  c.pity = pity;
  c.seen ??= Object.keys(inventory).filter((id) => inventory[id] > 0);
  persist();
  emit();
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
  /** item id → copies owned (cached; empty until the server has answered once) */
  get inventory(): Readonly<Record<string, number>> {
    return c.inventory;
  },
  /** the unanswered purchase of this account, if any (survives an app kill) */
  get pending(): PendingPull | null {
    bind();
    return c.pending;
  },
  setPending(p: PendingPull | null) {
    bind();
    c.pending = p;
    persist();
  },
  owns(itemId: string): boolean {
    return (c.inventory[itemId] ?? 0) > 0;
  },
  /** owned, but not yet looked at in the Wardrobe */
  isNew(itemId: string): boolean {
    return !!c.seen && wallet.owns(itemId) && !c.seen.includes(itemId);
  },
  markSeen(ids: string[]) {
    if (!c.seen) return;
    const fresh = ids.filter((id) => wallet.isNew(id));
    if (!fresh.length) return;
    c.seen.push(...fresh);
    persist();
    emit();
  },
  /** box id → pulls since the last LEGENDARY+ */
  get pity(): Readonly<Record<string, number>> {
    return c.pity;
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
        setHoldings(w.inventory, w.pity);
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
   * Buys `qty` boxes on the server (online only). Throws ApiError: `insufficient_jade`, `rate_limited`, `offline`, ...
   * Retrying after a network failure must reuse the same `ref`, so the server returns the original result instead of
   * charging twice; `newPullRef()` makes one per purchase.
   */
  async pull(box: string, qty: number, ref: string): Promise<ShopPullResponse> {
    const body: ShopPullRequest = { box, qty, ref };
    const r = await cloud.authed<ShopPullResponse>('POST', '/shop/pull', body);
    bind();
    const inventory = { ...c.inventory };
    for (const d of r.drops) inventory[d.itemId] = Math.max(inventory[d.itemId] ?? 0, d.copies);
    setHoldings(inventory, { ...c.pity, ...r.pity });
    setJade(r.jade);
    return r;
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

/** idempotency key for one purchase (keep it across retries of that purchase) */
export const newPullRef = (): string => crypto.randomUUID();
