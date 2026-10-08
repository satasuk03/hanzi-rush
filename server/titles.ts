/**
 * Title Jade rewards. Every title with tier > 0 pays TITLE_REWARD[tier] Jade once, when the player's STORED cloud save
 * (plus the server inventory for the `cosmetics` / `sets` kinds) meets its requirement. The client names nothing: it
 * just asks, and the server evaluates with the same shared evaluator the client uses.
 *
 * Ledger: reason 'title', ref = title id, UNIQUE (player_id, reason, ref), so a title never pays twice.
 * Retroactive: an account's FIRST claim (no 'title' row yet) pays min(sum, TITLE_RETRO_CAP). When the sum is over the
 * cap, every due title gets a settled marker (delta 0) and one 'retro' row carries the lump. Later unlocks pay in full.
 *
 * Concurrency: every insert is guarded by `players.title_claim_at IS <the value we read>`, and the batch ends by moving
 * that value. Two simultaneous claims therefore read the same value; whichever batch D1 runs second inserts nothing,
 * so neither double-pays nor counts as a second "first claim" with a stale due list.
 */
import type { SaveDoc, TitleClaimResponse } from '../shared/api';
import { TITLE_DEFS, TITLE_REWARD, TITLE_RETRO_CAP, titleUnlocked } from '../shared/titles';
import { factsFromSave } from './titleFacts';
import { minInterval } from './ratelimit';

export const TITLE_CLAIM_MIN_MS = 10_000;

export async function claimTitles(db: D1Database, playerId: string, now = Date.now()): Promise<TitleClaimResponse> {
  const [pl, sv, inv, paidRows] = await db.batch<Record<string, any>>([
    db.prepare('SELECT jade, title_claim_at FROM players WHERE id = ?1').bind(playerId),
    db.prepare('SELECT data FROM saves WHERE player_id = ?1').bind(playerId),
    db.prepare('SELECT item_id, copies FROM inventory WHERE player_id = ?1').bind(playerId),
    db.prepare("SELECT ref FROM jade_ledger WHERE player_id = ?1 AND reason = 'title'").bind(playerId),
  ]);
  const row = pl.results[0] as { jade: number; title_claim_at: number | null } | undefined;
  const jade = row?.jade ?? 0;
  const none = (): TitleClaimResponse => ({ paid: [], retro: 0, jade });
  if (!row) return none();
  minInterval(row.title_claim_at, TITLE_CLAIM_MIN_MS, now);

  const data = sv.results[0]?.data as string | undefined;
  if (!data) return none();
  const paidRefs = new Set<string>(paidRows.results.map((r) => r.ref));
  let due: typeof TITLE_DEFS;
  try {
    const facts = factsFromSave(JSON.parse(data) as SaveDoc, new Map(inv.results.map((r) => [r.item_id as string, r.copies as number])));
    due = TITLE_DEFS.filter((d) => d.tier > 0 && !paidRefs.has(d.id) && titleUnlocked(d, facts));
  } catch {
    return none();
  }
  if (!due.length) return none();

  const first = paidRefs.size === 0;
  const sum = due.reduce((s, d) => s + TITLE_REWARD[d.tier], 0);
  const lump = first && sum > TITLE_RETRO_CAP;
  const rows: { ref: string; delta: number; title: boolean }[] = due.map((d) => ({ ref: d.id, delta: lump ? 0 : TITLE_REWARD[d.tier], title: true }));
  if (lump) rows.push({ ref: 'retro', delta: TITLE_RETRO_CAP, title: false });

  const stmts: D1PreparedStatement[] = [];
  const insertAt: number[] = [];
  for (const r of rows) {
    insertAt.push(stmts.length);
    stmts.push(
      db
        .prepare(
          `INSERT INTO jade_ledger (player_id, delta, reason, ref, created_at, balance_after)
           SELECT ?1, ?2, 'title', ?3, ?4, jade + ?2 FROM players WHERE id = ?1 AND title_claim_at IS ?5
           ON CONFLICT (player_id, reason, ref) DO NOTHING`,
        )
        .bind(playerId, r.delta, r.ref, now, row.title_claim_at),
    );
    // a delta-0 marker needs no balance update, and skipping it keeps changes() unambiguous for the next insert
    if (r.delta !== 0) stmts.push(db.prepare('UPDATE players SET jade = jade + ?2 WHERE id = ?1 AND changes() > 0').bind(playerId, r.delta));
  }
  stmts.push(db.prepare('UPDATE players SET title_claim_at = ?2 WHERE id = ?1 AND title_claim_at IS ?3').bind(playerId, now, row.title_claim_at));
  stmts.push(db.prepare('SELECT jade FROM players WHERE id = ?1').bind(playerId));
  const res = await db.batch<Record<string, any>>(stmts);

  const out: TitleClaimResponse = { paid: [], retro: 0, jade: res[res.length - 1].results[0]?.jade ?? jade };
  rows.forEach((r, i) => {
    if (res[insertAt[i]].meta.changes <= 0) return;
    if (r.title) out.paid.push({ id: r.ref, jade: r.delta });
    else out.retro = r.delta;
  });
  return out;
}
