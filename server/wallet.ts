/**
 * Jade wallet (docs/cosmetics-shop.md §11). `jade_ledger` is the truth, `players.jade` its cached sum.
 *
 * Every write is ONE D1 batch (a transaction): ledger row first, then the balance, so the two cannot diverge.
 *  - Idempotent: the ledger is UNIQUE (player_id, reason, ref). A replayed ref inserts nothing, and the balance
 *    update is guarded by `changes() > 0`, so it does not move either.
 *  - Never negative: the ledger row is only inserted `WHERE jade + delta >= 0`. Two concurrent spends are serialized
 *    by D1; the second sees the lower balance and inserts nothing. (`players.jade` also has CHECK (jade >= 0).)
 */
import { featuredSet } from '../shared/cosmetics';
import { JADE_DAILY, JADE_STARTER, bangkokDay, dayNumber, type JadeDailyResponse, type JadeGrantResponse, type WalletDaily, type WalletResponse } from '../shared/api';

export type JadeReason = 'starter' | 'daily' | 'pull' | 'dupe_refund' | 'iap' | 'ad' | 'admin' | 'deal' | 'title';

export interface JadeWrite {
  status: 'applied' | 'replay' | 'insufficient';
  /** the delta that was (or, for a replay, originally was) applied; 0 when insufficient */
  delta: number;
  jade: number;
}

/**
 * Applies `delta` (negative = spend) once per (player, reason, ref). `extra` statements run in the same batch after the
 * balance update and may rely on the ledger row existing (`EXISTS (SELECT 1 FROM jade_ledger WHERE ...)`).
 */
export async function applyJade(db: D1Database, playerId: string, delta: number, reason: JadeReason, ref: string, now = Date.now(), extra: D1PreparedStatement[] = []): Promise<JadeWrite> {
  const res = await db.batch([
    db
      .prepare(
        `INSERT INTO jade_ledger (player_id, delta, reason, ref, created_at, balance_after)
         SELECT ?1, ?2, ?3, ?4, ?5, jade + ?2 FROM players WHERE id = ?1 AND jade + ?2 >= 0
         ON CONFLICT (player_id, reason, ref) DO NOTHING`,
      )
      .bind(playerId, delta, reason, ref, now),
    db.prepare('UPDATE players SET jade = jade + ?2 WHERE id = ?1 AND changes() > 0').bind(playerId, delta),
    ...extra,
  ]);
  const jade = (await db.prepare('SELECT jade FROM players WHERE id = ?1').bind(playerId).first<{ jade: number }>())?.jade ?? 0;
  if (res[0].meta.changes > 0) return { status: 'applied', delta, jade };
  const prior = await db.prepare('SELECT delta FROM jade_ledger WHERE player_id = ?1 AND reason = ?2 AND ref = ?3').bind(playerId, reason, ref).first<{ delta: number }>();
  return prior ? { status: 'replay', delta: prior.delta, jade } : { status: 'insufficient', delta: 0, jade };
}

/** spend `cost` Jade (shop pulls, phase C). `ref` is the client's idempotency key. */
export const spendJade = (db: D1Database, playerId: string, cost: number, reason: JadeReason, ref: string, now?: number) => applyJade(db, playerId, -cost, reason, ref, now);

const grant = (w: JadeWrite): JadeGrantResponse => ({ granted: w.status === 'insufficient' ? 0 : w.delta, replay: w.status !== 'applied', jade: w.jade });

/** 100 Jade, once per account. */
export async function claimStarter(db: D1Database, playerId: string, now = Date.now()): Promise<JadeGrantResponse> {
  return grant(await applyJade(db, playerId, JADE_STARTER, 'starter', 'starter', now));
}

interface DailyRow {
  last_day: string;
  streak: number;
}

/** streak maths shared by GET /wallet and the claim */
export function dailyState(row: DailyRow | null, today: string): WalletDaily {
  const gap = row ? dayNumber(today) - dayNumber(row.last_day) : Infinity;
  // gap < 0 only if the clock went backwards: never pay twice, never break the streak
  const claimable = gap >= 1;
  const streak = gap <= 1 && row ? row.streak : 0;
  const next = gap === 1 && row ? row.streak + 1 : claimable ? 1 : (row?.streak ?? 0);
  return { day: today, claimable, streak, next, slot: Math.max(0, (next - 1) % JADE_DAILY.length) };
}

/**
 * Pays the next streak slot once per Bangkok day. `claimDay` lets a claim queued offline count for the day it was
 * tapped (today or yesterday only; anything else counts as today).
 */
export async function claimDaily(db: D1Database, playerId: string, claimDay?: string, now = Date.now()): Promise<JadeDailyResponse> {
  const today = bangkokDay(now);
  const yesterday = bangkokDay(now - 86_400_000);
  const day = claimDay === today || claimDay === yesterday ? claimDay : today;
  const row = await db.prepare('SELECT last_day, streak FROM jade_daily WHERE player_id = ?1').bind(playerId).first<DailyRow>();
  const st = dailyState(row, day);
  let w: JadeWrite | null = null;
  if (st.claimable) {
    w = await applyJade(db, playerId, JADE_DAILY[st.slot], 'daily', day, now, [
      // the streak only moves when the ledger row exists, and never backwards (a racing replay is a no-op)
      db
        .prepare(
          `INSERT INTO jade_daily (player_id, last_day, streak)
           SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM jade_ledger WHERE player_id = ?1 AND reason = 'daily' AND ref = ?2)
           ON CONFLICT (player_id) DO UPDATE SET last_day = excluded.last_day, streak = excluded.streak WHERE jade_daily.last_day < excluded.last_day`,
        )
        .bind(playerId, day, st.next),
    ]);
  }
  if (w?.status === 'applied') return { ...grant(w), day, streak: st.next, slot: st.slot };
  // already claimed (or lost a race to a twin request): report the stored state
  const cur = await db.prepare('SELECT last_day, streak FROM jade_daily WHERE player_id = ?1').bind(playerId).first<DailyRow>();
  const jade = w?.jade ?? (await db.prepare('SELECT jade FROM players WHERE id = ?1').bind(playerId).first<{ jade: number }>())?.jade ?? 0;
  const streak = cur?.streak ?? 0;
  return { granted: w && w.status === 'replay' ? w.delta : 0, replay: true, jade, day, streak, slot: Math.max(0, (streak - 1) % JADE_DAILY.length) };
}

export async function walletState(db: D1Database, playerId: string, now = Date.now()): Promise<WalletResponse> {
  const [p, starter, daily, inv, pity, titles] = await db.batch<Record<string, any>>([
    db.prepare('SELECT jade FROM players WHERE id = ?1').bind(playerId),
    db.prepare("SELECT 1 AS x FROM jade_ledger WHERE player_id = ?1 AND reason = 'starter' AND ref = 'starter'").bind(playerId),
    db.prepare('SELECT last_day, streak FROM jade_daily WHERE player_id = ?1').bind(playerId),
    db.prepare('SELECT item_id, copies FROM inventory WHERE player_id = ?1').bind(playerId),
    db.prepare('SELECT banner_id, pulls_since FROM banner_pity WHERE player_id = ?1').bind(playerId),
    db.prepare("SELECT ref FROM jade_ledger WHERE player_id = ?1 AND reason = 'title' AND ref != 'retro'").bind(playerId),
  ]);
  const f = featuredSet(now);
  return {
    jade: p.results[0]?.jade ?? 0,
    starterClaimed: starter.results.length > 0,
    daily: dailyState((daily.results[0] as DailyRow | undefined) ?? null, bangkokDay(now)),
    inventory: Object.fromEntries(inv.results.map((r) => [r.item_id, r.copies])),
    pity: Object.fromEntries(pity.results.map((r) => [r.banner_id, r.pulls_since])),
    titlesPaid: titles.results.map((r) => r.ref as string),
    serverTime: now,
    featured: { set: f.set.id, endsAt: f.endsAt },
  };
}
