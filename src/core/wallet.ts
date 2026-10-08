/**
 * Jade wallet, client side (docs/cosmetics-shop.md §11). The server owns the balance; this module only caches it so
 * the home chip works offline, claims the one-time starter grant, and sends the daily claim (queued until it lands).
 */
import {
  bangkokDay,
  type ContinueRequest,
  type ContinueResponse,
  type ContinueVia,
  type JadeDailyResponse,
  type JadeStarterResponse,
  type ShopDealBuyRequest,
  type ShopDealBuyResponse,
  type ShopDealsResponse,
  type ShopPullRequest,
  type ShopPullResponse,
  type TitleClaimResponse,
  type WalletResponse,
} from '../../shared/api';
import { API_OFF, ApiError } from './api';
import { cloud, uuid } from './cloud';
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
  /** the Set Box's featured set and when it rotates (epoch ms), as last seen from the server; null = unknown */
  featured: { set: string; endsAt: number } | null;
  /** title ids already paid their Jade reward, as last seen from the server */
  titlesPaid: string[];
}

export interface PendingPull {
  box: string;
  qty: number;
  ref: string;
  /** the featured set the buyer saw (Set Box only): a resumed purchase sends the same one */
  set?: string;
}

const KEY = 'hanzi-rush:wallet:v1';
const empty = (): Cache => ({ playerId: null, jade: null, pendingDay: null, inventory: {}, pity: {}, pending: null, seen: null, featured: null, titlesPaid: [] });

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
/** an old server (no /titles/claim): stop asking until the app restarts */
let titlesOff = false;
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
  /** the Set Box's featured set and rotation time (null until the server has said, or on an old server) */
  get featured(): Readonly<{ set: string; endsAt: number }> | null {
    return c.featured;
  },
  /** a `rotated` refusal names the current featured set: take it without a wallet round-trip */
  setFeatured(f: { set: string; endsAt: number }) {
    bind();
    c.featured = f;
    persist();
    emit();
  },
  /** title ids whose Jade reward is already paid */
  get titlesPaid(): readonly string[] {
    return c.titlesPaid ?? [];
  },
  /** an old server (no `titlesPaid` in /wallet, or a 404 to a claim) this session: rewards are not on offer */
  get titlesOff(): boolean {
    return titlesOff;
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
        c.featured = w.featured ?? null;
        c.titlesPaid = w.titlesPaid ?? [];
        // an old server has no title rewards: no chips, no claims
        if (!w.titlesPaid) titlesOff = true;
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
  async pull(box: string, qty: number, ref: string, set?: string): Promise<ShopPullResponse> {
    const body: ShopPullRequest = set ? { box, qty, ref, set } : { box, qty, ref };
    const r = await cloud.authed<ShopPullResponse>('POST', '/shop/pull', body);
    bind();
    const inventory = { ...c.inventory };
    for (const d of r.drops) inventory[d.itemId] = Math.max(inventory[d.itemId] ?? 0, d.copies);
    // set-completion seals granted by this pull (absent from an old server)
    for (const id of r.bonuses ?? []) inventory[id] = Math.max(inventory[id] ?? 0, 1);
    setHoldings(inventory, { ...c.pity, ...r.pity });
    setJade(r.jade);
    return r;
  },

  /**
   * Pays continue `n` of a rush run (online only). Throws ApiError: `insufficient_jade`, `ad_unverified` (AdMob has
   * not called back yet: retry), `continue_refused`, `offline`, ... Retrying the same (ticket, n) never charges twice.
   */
  async continueRun(ticket: string, n: number, via: ContinueVia): Promise<ContinueResponse> {
    const body: ContinueRequest = { ticket, n, via };
    const r = await cloud.authed<ContinueResponse>('POST', '/runs/continue', body);
    setJade(r.jade);
    return r;
  },

  /** today's three direct-buy deals (online only). Throws ApiError. */
  deals(): Promise<ShopDealsResponse> {
    return cloud.authed<ShopDealsResponse>('GET', '/shop/deals');
  },

  /**
   * Buys one deal (online only). Throws ApiError: `insufficient_jade` (402), 400 with reason `rotated` / `owned` /
   * `bought` / `no_deal`, `rate_limited`, ... Retrying after a network failure must reuse the same `ref`.
   */
  async buyDeal(day: string, slot: number, ref: string): Promise<ShopDealBuyResponse> {
    const body: ShopDealBuyRequest = { day, slot, ref };
    const r = await cloud.authed<ShopDealBuyResponse>('POST', '/shop/deals', body);
    bind();
    const inventory = { ...c.inventory, [r.itemId]: Math.max(c.inventory[r.itemId] ?? 0, r.copies) };
    for (const id of r.bonuses ?? []) inventory[id] = Math.max(inventory[id] ?? 0, 1);
    setHoldings(inventory, c.pity);
    setJade(r.jade);
    return r;
  },

  /**
   * Asks the server to pay the Jade of every title unlocked and not yet paid. Resolves to the result, or null (offline,
   * rate limited, old server): the next trigger tries again. A 404 stops the attempts for this session.
   */
  async claimTitles(): Promise<TitleClaimResponse | null> {
    if (API_OFF || titlesOff) return null;
    try {
      const r = await cloud.authed<TitleClaimResponse>('POST', '/titles/claim');
      bind();
      const paid = new Set(c.titlesPaid ?? []);
      for (const p of r.paid) paid.add(p.id);
      c.titlesPaid = [...paid];
      setJade(r.jade);
      persist();
      emit();
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        titlesOff = true;
        emit();
      }
      return null;
    }
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
export const newPullRef = (): string => uuid();
