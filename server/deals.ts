/**
 * Daily direct-buy deals (phase D2, docs/cosmetics-shop.md). 3 deals per player per Bangkok day, a pure Jade sink.
 *
 * Offer (dealsFor, pure): seeded by `players.id` + the day, so it is deterministic and the client cannot steer it.
 * Candidates are gacha items the player did not own at the START of the day (inventory.first_at < dayStart), so the
 * offer stays stable all day: buying a deal or pulling one of its items never reshuffles the others. MYTHIC is never
 * offered. Each slot consumes exactly two rng() calls (rarity, pick), so slots never shift each other.
 *
 * Purchase (buyDeal): mirrors server/shop.ts pull(): a snapshot batch, then ONE write batch guarded like a pull.
 *  1. the 'deal' ledger row, inserted only `WHERE jade - price >= 0 AND pull_seq = <snapshot> AND slot not bought
 *     today`, ON CONFLICT (player, reason, ref) DO NOTHING. It decides whether the purchase happens.
 *  2. the stored shop_deals row `WHERE changes() > 0`, carrying this attempt's `tx`.
 *  3+. balance + pull_seq bump, inventory, set bonuses: guarded by `mine` (a shop_deals row with this ref AND tx), so
 *     a replayed ref (other tx) writes nothing. pull_seq is bumped in the same batch: a concurrent pull that rolled
 *     from the old inventory then loses its version race and re-rolls (otherwise it could mislabel isNew).
 * Same ref twice: the loser re-reads, finds the stored row and answers it as a replay. A replay returns
 * `bonuses: []`. Rate limit: shares players.pull_at with pulls (LIMITS.pullMinIntervalSec), checked after replay.
 */
import { DAY_RE, LIMITS, bangkokDay, type ShopDeal, type ShopDealBuyResponse, type ShopDealsResponse } from '../shared/api';
import { DEAL_PRICE, DEAL_SLOTS, bonusesDue, gachaPool, itemById, type RarityIdx } from '../shared/cosmetics';
import { randomTicket } from './crypto';
import { fail } from './http';
import { minInterval } from './ratelimit';
import { PULL_REF_RE } from './shop';

const MAX_ATTEMPTS = 5;
const DAY_MS = 86_400_000;
const POOLS = ([0, 1, 2, 3, 4] as const).map((r) => gachaPool(r).map((i) => i.id).sort());

/** start of a Bangkok day in epoch ms */
export const dayStart = (day: string): number => Date.parse(day + 'T00:00:00Z') - 7 * 3600_000;

export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DealOffer {
  slot: number;
  itemId: string;
  rarity: number;
  price: number;
}

/** The day's offer for `seed` (players.id). Pure. `ownedBefore` = item ids owned at the start of `day`. */
export function dealsFor(seed: string, day: string, ownedBefore: ReadonlySet<string>): DealOffer[] {
  const rng = mulberry32(fnv1a32(`${seed}|${day}`));
  const taken = new Set<string>();
  const out: DealOffer[] = [];
  DEAL_SLOTS.forEach((weights, slot) => {
    // two draws per slot, always
    const u = rng() * weights.reduce((s, w) => s + w, 0);
    const v = rng();
    let want: RarityIdx = 0;
    let acc = 0;
    for (let r = 0; r < 4; r++) {
      acc += weights[r];
      want = r as RarityIdx;
      if (u < acc) break;
    }
    const order: number[] = [];
    for (let r = want; r <= 3; r++) order.push(r);
    for (let r = want - 1; r >= 0; r--) order.push(r);
    for (const r of order) {
      const cands = POOLS[r].filter((id) => !ownedBefore.has(id) && !taken.has(id));
      if (!cands.length) continue;
      const itemId = cands[Math.floor(v * cands.length)];
      taken.add(itemId);
      out.push({ slot, itemId, rarity: r, price: DEAL_PRICE[r] });
      break;
    }
  });
  return out;
}

const ownedBeforeOf = (rows: readonly Record<string, any>[], day: string): Set<string> => {
  const start = dayStart(day);
  return new Set(rows.filter((r) => r.copies > 0 && r.first_at < start).map((r) => r.item_id as string));
};

/** GET /shop/deals */
export async function dealState(db: D1Database, playerId: string, now = Date.now()): Promise<ShopDealsResponse> {
  const day = bangkokDay(now);
  const [invR, boughtR] = await db.batch<Record<string, any>>([
    db.prepare('SELECT item_id, copies, first_at FROM inventory WHERE player_id = ?1').bind(playerId),
    db.prepare('SELECT slot, item_id, price FROM shop_deals WHERE player_id = ?1 AND day = ?2').bind(playerId, day),
  ]);
  const copies = new Map<string, number>(invR.results.map((r) => [r.item_id as string, r.copies as number]));
  const offers = new Map<number, DealOffer>(dealsFor(playerId, day, ownedBeforeOf(invR.results, day)).map((o) => [o.slot, o]));
  // a bought slot shows what was bought, even if the offer moved since (a catalog change deployed mid-day)
  for (const r of boughtR.results as DealRow[]) offers.set(r.slot, { slot: r.slot, itemId: r.item_id, rarity: itemById(r.item_id)?.rarity ?? 0, price: r.price });
  const bought = new Set<number>(boughtR.results.map((r) => r.slot as number));
  const deals: ShopDeal[] = [...offers.values()]
    .sort((a, b) => a.slot - b.slot)
    .map((o) => ({ ...o, bought: bought.has(o.slot), owned: (copies.get(o.itemId) ?? 0) > 0 }));
  return { day, endsAt: dayStart(day) + DAY_MS, deals, serverTime: now };
}

export interface DealOptions {
  now?: number;
  /** default LIMITS.pullMinIntervalSec; tests pass 0 */
  minIntervalMs?: number;
}

interface DealRow {
  day: string;
  slot: number;
  item_id: string;
  price: number;
}

/** POST /shop/deals. A replayed `ref` returns the stored original result and charges nothing. */
export async function buyDeal(db: D1Database, playerId: string, day: unknown, slot: unknown, ref: unknown, opts: DealOptions = {}): Promise<ShopDealBuyResponse> {
  if (typeof ref !== 'string' || !PULL_REF_RE.test(ref)) return fail('bad_request', 'Invalid ref');
  if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= DEAL_SLOTS.length) return fail('bad_request', 'Invalid slot');
  if (typeof day !== 'string' || !DAY_RE.test(day)) return fail('bad_request', 'Invalid day');
  const minMs = opts.minIntervalMs ?? LIMITS.pullMinIntervalSec * 1000;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const now = opts.now ?? Date.now();
    const [pR, priorR, spentR, invR, todayR] = await db.batch<Record<string, any>>([
      db.prepare('SELECT jade, pull_seq, pull_at FROM players WHERE id = ?1').bind(playerId),
      db.prepare('SELECT day, slot, item_id, price FROM shop_deals WHERE player_id = ?1 AND ref = ?2').bind(playerId, ref),
      db.prepare("SELECT 1 AS x FROM jade_ledger WHERE player_id = ?1 AND reason = 'deal' AND ref = ?2").bind(playerId, ref),
      db.prepare('SELECT item_id, copies, first_at FROM inventory WHERE player_id = ?1').bind(playerId),
      db.prepare('SELECT slot FROM shop_deals WHERE player_id = ?1 AND day = ?2').bind(playerId, bangkokDay(now)),
    ]);
    const p = pR.results[0] as { jade: number; pull_seq: number; pull_at: number | null } | undefined;
    if (!p) return fail('unauthorized', 'Account not found');
    const prior = priorR.results[0] as DealRow | undefined;
    if (prior) {
      const c = (invR.results.find((r) => r.item_id === prior.item_id)?.copies as number | undefined) ?? 0;
      return { day: prior.day, slot: prior.slot, itemId: prior.item_id, price: prior.price, jade: p.jade, copies: c, bonuses: [], replay: true };
    }
    if (spentR.results.length) return fail('bad_request', 'ref already used');
    if (day !== bangkokDay(now)) return fail('bad_request', 'The deals changed', { reason: 'rotated' });
    const offer = dealsFor(playerId, day, ownedBeforeOf(invR.results, day)).find((o) => o.slot === slot);
    if (!offer) return fail('bad_request', 'No deal in this slot', { reason: 'no_deal' });
    if (todayR.results.some((r) => r.slot === slot)) return fail('bad_request', 'Already bought', { reason: 'bought' });
    const inventory = new Map<string, number>(invR.results.map((r) => [r.item_id as string, r.copies as number]));
    if ((inventory.get(offer.itemId) ?? 0) > 0) return fail('bad_request', 'Already owned', { reason: 'owned' });
    minInterval(p.pull_at, minMs, now);
    if (p.jade < offer.price) return fail('insufficient_jade', 'Not enough Jade', { body: { jade: p.jade, cost: offer.price } });

    const bonuses = bonusesDue((id) => id === offer.itemId || (inventory.get(id) ?? 0) > 0);
    const tx = randomTicket();
    // ?1 player, ?2 ref, ?3 tx in every guarded statement
    const mine = 'EXISTS (SELECT 1 FROM shop_deals WHERE player_id = ?1 AND ref = ?2 AND tx = ?3)';
    const stmts: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO jade_ledger (player_id, delta, reason, ref, created_at, balance_after)
           SELECT ?1, -?3, 'deal', ?2, ?4, jade - ?3 FROM players
           WHERE id = ?1 AND jade - ?3 >= 0 AND pull_seq = ?5
             AND NOT EXISTS (SELECT 1 FROM shop_deals WHERE player_id = ?1 AND day = ?6 AND slot = ?7)
           ON CONFLICT (player_id, reason, ref) DO NOTHING`,
        )
        .bind(playerId, ref, offer.price, now, p.pull_seq, day, slot),
      db
        .prepare(
          `INSERT INTO shop_deals (player_id, ref, tx, day, slot, item_id, price, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE changes() > 0`,
        )
        .bind(playerId, ref, tx, day, slot, offer.itemId, offer.price, now),
      db
        .prepare(`UPDATE players SET jade = jade - ?4, pull_seq = pull_seq + 1, pull_at = ?5 WHERE id = ?1 AND ${mine}`)
        .bind(playerId, ref, tx, offer.price, now),
      db
        .prepare(
          `INSERT INTO inventory (player_id, item_id, copies, first_at) SELECT ?1, ?4, 1, ?5 WHERE ${mine}
           ON CONFLICT (player_id, item_id) DO UPDATE SET copies = copies + 1`,
        )
        .bind(playerId, ref, tx, offer.itemId, now),
    ];
    for (const itemId of bonuses) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO inventory (player_id, item_id, copies, first_at) SELECT ?1, ?4, 1, ?5 WHERE ${mine}
             ON CONFLICT (player_id, item_id) DO NOTHING`,
          )
          .bind(playerId, ref, tx, itemId, now),
      );
    }
    stmts.push(db.prepare('SELECT jade FROM players WHERE id = ?1').bind(playerId));

    const res = await db.batch<Record<string, any>>(stmts);
    if (res[0].meta.changes > 0) {
      return { day, slot, itemId: offer.itemId, price: offer.price, jade: res[res.length - 1].results[0]?.jade ?? 0, copies: 1, bonuses, replay: false };
    }
    // nothing written: a twin with the same ref, a newer pull_seq, a slot bought meanwhile or a balance that moved
  }
  return fail('rate_limited', 'Too many requests at once', { retryAfter: 1 });
}
