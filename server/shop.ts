/**
 * Box pulls (docs/cosmetics-shop.md §5.2, §11.2, §11.6b). The server rolls; the client only names the box, the
 * quantity and an idempotency `ref`.
 *
 * Roll (rollPull, pure, so it can be tested without a database):
 *  - Rarity by the box `rates`, renormalised over the rarities at or above a floor. The floor is the box `minRarity`,
 *    raised to PITY_RARITY when this box is the `pity`-th since the last LEGENDARY+ (hard pity), and to EPIC for the
 *    last roll of a ×10 that has no EPIC+ yet. A forced roll keeps the box's relative odds above the floor (Standard
 *    pity: LEGENDARY 4 : MYTHIC 1), it does not always give the floor itself.
 *  - Then an item of that rarity from gachaPool(), unowned items weighted ×3. "Owned" includes earlier drops of the
 *    same batch, so a ×10 prefers ten different items.
 *  - Empty pool rule: if the rolled rarity has no gacha item, take the nearest non-empty rarity UPWARD first (never
 *    worse than the roll, so the floor, the pity and the ×10 guarantee still hold), then downward but not below the
 *    roll's floor. Only if nothing exists at or above that floor do we go further down, never below the box
 *    minRarity; then the guarantee is unsatisfiable and the pity counter simply does not reset. Nothing at all → 500.
 *  - Pity counts every box: reset to 0 by any LEGENDARY+ drop (natural or forced, judged by the item that actually
 *    dropped), otherwise +1. The ×10 guarantee also looks at the items that actually dropped.
 *  - A drop of an item owned before this drop is a duplicate and refunds DUPLICATE_REFUND[item rarity].
 *
 * Write: ONE db.batch (a D1 transaction). Order and guards:
 *  1. the spend ledger row ('pull', ref), inserted only `WHERE jade - cost >= 0 AND pull_seq = <snapshot seq>`,
 *     ON CONFLICT (player, reason, ref) DO NOTHING. This one statement decides whether the pull happens.
 *  2. the stored result row (shop_pulls), inserted `WHERE changes() > 0`, i.e. only if (1) inserted. It carries `tx`,
 *     a random id of THIS attempt.
 *  3+. every other write (balance and pull_seq, refund ledger row, inventory, pity) is guarded by
 *     `EXISTS (shop_pulls row with this player, ref AND tx)`. A replayed ref (same ref, other attempt, so another
 *     tx), an insufficient balance or a stale snapshot leave (1) and (2) empty, so the whole batch writes nothing.
 *
 * Concurrency: the roll is computed from a snapshot (balance, inventory, every box's pity, players.pull_seq) read
 * before the batch. players.pull_seq is a per-player pull version: (1) only inserts if it is unchanged and (3) bumps
 * it, and D1 runs batches one at a time. So of two concurrent pulls that read the same snapshot, the second one's
 * batch finds a newer pull_seq and writes nothing; it then re-reads the snapshot and re-rolls (MAX_ATTEMPTS, then a
 * 429). Hence no two pulls ever consume the same pity count or compute "unowned"/duplicate/refund from stale
 * inventory, and pity can be written as an absolute value. The balance guard in (1) makes an overdraw impossible
 * independently of that (and players.jade has CHECK (jade >= 0)). Same-ref twins: the loser finds the stored row on
 * its re-read and answers it as a replay. Anything else that writes `inventory` later (grants, exchange) must bump
 * players.pull_seq in its own batch, or a concurrent pull could mislabel a duplicate as new.
 *
 * Sets (phase D): the `set` box passes a `feature` set of item ids to rollPull; when the rolled rarity has a featured
 * item, SET_RATE_UP of the drops come from it (the extra rng() is only drawn then, so every other roll is unchanged).
 * The client names the featured set it saw (`opts.set`); a stale one is refused ('rotated') AFTER the replay lookup, so
 * a retried ref from last week still gets its result. Set bonuses (the 'set'-source badge of every completed set not
 * yet owned, also sets completed before they existed) are inserted in the same batch, guarded by `mine`; the pull
 * already bumps pull_seq. A replay returns `bonuses: []` (the badge is in the inventory already).
 *
 * Rate limit: LIMITS.pullMinIntervalSec between APPLIED pulls (players.pull_at), checked after the replay lookup so
 * a retried ref always gets its answer. A pull that lost a version race re-checks it on the re-read, so concurrent
 * different refs from one player end in at most one success per interval in production.
 */
import { LIMITS, type ShopDrop, type ShopPullResponse } from '../shared/api';
import { BOXES, BOX_MULTI, DUPLICATE_REFUND, PITY_RARITY, SET_RATE_UP, bonusesDue, boxById, boxPrice, featuredSet, gachaPool, type BoxDef, type Item, type RarityIdx } from '../shared/cosmetics';
import { randomTicket } from './crypto';
import { fail } from './http';
import { minInterval } from './ratelimit';

/** uniform in [0, 1) */
export type Rng = () => number;

/** 53 bits of crypto randomness */
export const cryptoRng: Rng = () => {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return (a[0] * 2 ** 21 + (a[1] >>> 11)) / 2 ** 53;
};

/** the rarity the ×10 guarantees (EPIC) */
export const MULTI_RARITY: RarityIdx = 2;
/** weight of an item the player does not own yet, against 1 for an owned one */
export const UNOWNED_WEIGHT = 3;
/** client refs: uuid-ish */
export const PULL_REF_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_ATTEMPTS = 5;
const TOP: RarityIdx = 4;

export type PoolFn = (rarity: RarityIdx) => readonly Item[];
const POOLS = ([0, 1, 2, 3, 4] as const).map((r) => gachaPool(r));
const defaultPool: PoolFn = (r) => POOLS[r];

const maxR = (a: RarityIdx, b: RarityIdx): RarityIdx => (a > b ? a : b);

/** rarity by `rates`, renormalised over [floor, MYTHIC]. A box with no weight there gives the floor. */
export function rollRarity(rates: BoxDef['rates'], floor: RarityIdx, rng: Rng): RarityIdx {
  let total = 0;
  for (let r = floor; r <= TOP; r++) total += Math.max(0, rates[r]);
  if (total <= 0) return floor;
  let u = rng() * total;
  let last: RarityIdx = floor;
  for (let r = floor; r <= TOP; r++) {
    const w = Math.max(0, rates[r]);
    if (w <= 0) continue;
    last = r as RarityIdx;
    if (u < w) return last;
    u -= w;
  }
  return last; // floating point edge
}

/**
 * The empty-pool rule (see the header): the rolled rarity, then upward, then downward never below the box `min`. The
 * roll is always >= its floor (>= min), so the downward walk covers [floor, rolled) before [min, floor).
 */
export function resolveRarity(rolled: RarityIdx, min: RarityIdx, pool: PoolFn): RarityIdx {
  for (let r = rolled; r <= TOP; r++) if (pool(r as RarityIdx).length) return r as RarityIdx;
  for (let r = rolled - 1; r >= min; r--) if (pool(r as RarityIdx).length) return r as RarityIdx;
  return fail('server_error', 'This box has nothing to drop');
}

function pickItem(items: readonly Item[], copies: ReadonlyMap<string, number>, rng: Rng): Item {
  let total = 0;
  const w = items.map((i) => {
    const x = (copies.get(i.id) ?? 0) > 0 ? 1 : UNOWNED_WEIGHT;
    total += x;
    return x;
  });
  let u = rng() * total;
  for (let k = 0; k < items.length; k++) {
    if (u < w[k]) return items[k];
    u -= w[k];
  }
  return items[items.length - 1];
}

export interface Roll {
  drops: ShopDrop[];
  /** this box's pulls since the last LEGENDARY+, after the roll */
  pity: number;
}

/** the whole roll of one pull, from a snapshot: `pityBefore` of this box, `inventory` item id → copies */
export function rollPull(box: BoxDef, qty: number, pityBefore: number, inventory: ReadonlyMap<string, number>, rng: Rng, pool: PoolFn = defaultPool, feature?: ReadonlySet<string>): Roll {
  const copies = new Map(inventory);
  let pity = Math.max(0, pityBefore);
  let epic = false;
  const drops: ShopDrop[] = [];
  for (let i = 0; i < qty; i++) {
    let floor = box.minRarity;
    if (pity >= box.pity - 1) floor = maxR(floor, PITY_RARITY);
    if (qty === BOX_MULTI && i === qty - 1 && !epic) floor = maxR(floor, MULTI_RARITY);
    const rarity = resolveRarity(rollRarity(box.rates, floor, rng), box.minRarity, pool);
    const all = pool(rarity);
    const feat = feature ? all.filter((x) => feature.has(x.id)) : [];
    const it = pickItem(feat.length && rng() < SET_RATE_UP ? feat : all, copies, rng);
    const before = copies.get(it.id) ?? 0;
    copies.set(it.id, before + 1);
    drops.push({ itemId: it.id, rarity: it.rarity, isNew: before === 0, copies: before + 1, refund: before > 0 ? DUPLICATE_REFUND[it.rarity] : 0 });
    if (it.rarity >= MULTI_RARITY) epic = true;
    pity = it.rarity >= PITY_RARITY ? 0 : pity + 1;
  }
  return { drops, pity };
}

export interface PullOptions {
  now?: number;
  /** default LIMITS.pullMinIntervalSec; tests pass 0 */
  minIntervalMs?: number;
  /** the featured set id the client saw (required for the featured box) */
  set?: unknown;
  /** test only: the gacha pool per rarity */
  pool?: PoolFn;
}

interface PullRow {
  box: string;
  qty: number;
  cost: number;
  refund: number;
  drops: string;
  pity: string;
}

const replayOf = (r: PullRow, jade: number): ShopPullResponse => ({
  box: r.box,
  qty: r.qty,
  drops: JSON.parse(r.drops) as ShopDrop[],
  cost: r.cost,
  refund: r.refund,
  jade,
  pity: JSON.parse(r.pity) as Record<string, number>,
  bonuses: [],
  replay: true,
});

/**
 * POST /shop/pull. A replayed `ref` returns the stored original result (whatever box/qty this request names) with the
 * current balance and charges nothing.
 */
export async function pull(db: D1Database, playerId: string, boxId: unknown, qty: unknown, ref: unknown, rng: Rng = cryptoRng, opts: PullOptions = {}): Promise<ShopPullResponse> {
  const box = typeof boxId === 'string' ? boxById(boxId) : undefined;
  if (!box) return fail('bad_request', 'Unknown box');
  if (qty !== 1 && qty !== BOX_MULTI) return fail('bad_request', `qty must be 1 or ${BOX_MULTI}`);
  if (typeof ref !== 'string' || !PULL_REF_RE.test(ref)) return fail('bad_request', 'Invalid ref');
  const cost = boxPrice(box, qty);
  const minMs = opts.minIntervalMs ?? LIMITS.pullMinIntervalSec * 1000;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const now = opts.now ?? Date.now();
    // one consistent snapshot (a batch is a transaction)
    const [pR, priorR, spentR, invR, pityR] = await db.batch<Record<string, any>>([
      db.prepare('SELECT jade, pull_seq, pull_at FROM players WHERE id = ?1').bind(playerId),
      db.prepare('SELECT box, qty, cost, refund, drops, pity FROM shop_pulls WHERE player_id = ?1 AND ref = ?2').bind(playerId, ref),
      db.prepare("SELECT 1 AS x FROM jade_ledger WHERE player_id = ?1 AND reason = 'pull' AND ref = ?2").bind(playerId, ref),
      db.prepare('SELECT item_id, copies FROM inventory WHERE player_id = ?1').bind(playerId),
      db.prepare('SELECT banner_id, pulls_since FROM banner_pity WHERE player_id = ?1').bind(playerId),
    ]);
    const p = pR.results[0] as { jade: number; pull_seq: number; pull_at: number | null } | undefined;
    if (!p) return fail('unauthorized', 'Account not found');
    if (priorR.results[0]) return replayOf(priorR.results[0] as PullRow, p.jade);
    // a 'pull' ledger row without a stored result (written outside this module): the ref is taken, never charge it
    if (spentR.results.length) return fail('bad_request', 'ref already used');
    let feature: ReadonlySet<string> | undefined;
    let featSet: string | undefined;
    if (box.featured) {
      const f = featuredSet(now);
      if (opts.set !== f.set.id) return fail('bad_request', 'The featured set changed', { reason: 'rotated', body: { set: f.set.id, endsAt: f.endsAt } });
      feature = new Set(f.set.items);
      featSet = f.set.id;
    }
    minInterval(p.pull_at, minMs, now);
    if (p.jade < cost) return fail('insufficient_jade', 'Not enough Jade', { body: { jade: p.jade, cost } });

    const inventory = new Map<string, number>(invR.results.map((r) => [r.item_id as string, r.copies as number]));
    const pitySnap = new Map<string, number>(pityR.results.map((r) => [r.banner_id as string, r.pulls_since as number]));
    const roll = rollPull(box, qty, pitySnap.get(box.id) ?? 0, inventory, rng, opts.pool, feature);
    const refund = roll.drops.reduce((s, d) => s + d.refund, 0);
    const pityAfter: Record<string, number> = Object.fromEntries(BOXES.map((b) => [b.id, pitySnap.get(b.id) ?? 0]));
    pityAfter[box.id] = roll.pity;
    const gained = new Map<string, number>();
    for (const d of roll.drops) gained.set(d.itemId, (gained.get(d.itemId) ?? 0) + 1);
    // set bonuses: judged on the inventory after this pull; never granted twice (due = not owned yet)
    const bonuses = bonusesDue((id) => (inventory.get(id) ?? 0) + (gained.get(id) ?? 0) > 0);

    const tx = randomTicket();
    // ?1 player, ?2 ref, ?3 tx in every guarded statement
    const mine = 'EXISTS (SELECT 1 FROM shop_pulls WHERE player_id = ?1 AND ref = ?2 AND tx = ?3)';
    const stmts: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO jade_ledger (player_id, delta, reason, ref, created_at, balance_after)
           SELECT ?1, -?3, 'pull', ?2, ?4, jade - ?3 FROM players WHERE id = ?1 AND jade - ?3 >= 0 AND pull_seq = ?5
           ON CONFLICT (player_id, reason, ref) DO NOTHING`,
        )
        .bind(playerId, ref, cost, now, p.pull_seq),
      db
        .prepare(
          `INSERT INTO shop_pulls (player_id, ref, tx, seq, box, qty, cost, refund, drops, pity, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 WHERE changes() > 0`,
        )
        .bind(playerId, ref, tx, p.pull_seq + 1, box.id, qty, cost, refund, JSON.stringify(roll.drops), JSON.stringify(pityAfter), now),
      db
        .prepare(`UPDATE players SET jade = jade - ?4 + ?5, pull_seq = pull_seq + 1, pull_at = ?6 WHERE id = ?1 AND ${mine}`)
        .bind(playerId, ref, tx, cost, refund, now),
    ];
    if (refund > 0) {
      // one aggregated row; no ON CONFLICT: a clash would abort the whole batch rather than drop the refund silently
      stmts.push(
        db
          .prepare(
            `INSERT INTO jade_ledger (player_id, delta, reason, ref, created_at, balance_after)
             SELECT ?1, ?4, 'dupe_refund', ?5, ?6, jade FROM players WHERE id = ?1 AND ${mine}`,
          )
          .bind(playerId, ref, tx, refund, refundRef(ref), now),
      );
    }
    for (const [itemId, n] of gained) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO inventory (player_id, item_id, copies, first_at) SELECT ?1, ?4, ?5, ?6 WHERE ${mine}
             ON CONFLICT (player_id, item_id) DO UPDATE SET copies = copies + excluded.copies`,
          )
          .bind(playerId, ref, tx, itemId, n, now),
      );
    }
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
    stmts.push(
      db
        .prepare(
          `INSERT INTO banner_pity (player_id, banner_id, pulls_since) SELECT ?1, ?4, ?5 WHERE ${mine}
           ON CONFLICT (player_id, banner_id) DO UPDATE SET pulls_since = excluded.pulls_since`,
        )
        .bind(playerId, ref, tx, box.id, roll.pity),
      db.prepare('SELECT jade FROM players WHERE id = ?1').bind(playerId),
    );

    const res = await db.batch<Record<string, any>>(stmts);
    if (res[0].meta.changes > 0) {
      return { box: box.id, qty, drops: roll.drops, cost, refund, jade: res[res.length - 1].results[0]?.jade ?? 0, pity: pityAfter, bonuses, ...(featSet ? { set: featSet } : {}), replay: false };
    }
    // nothing written: a twin with the same ref, a newer pull_seq or a balance that moved. Re-read and decide again.
  }
  return fail('rate_limited', 'Too many pulls at once', { retryAfter: 1 });
}

/** ledger ref of a pull's duplicate refund (':' never appears in a client ref) */
export const refundRef = (ref: string): string => 'pull:' + ref;
