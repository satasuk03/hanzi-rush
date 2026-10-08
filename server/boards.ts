import { PERIODS, sanitizeLook, type BoardEntry, type Look, type Period, type PeriodKeys, type RankInfo } from '../shared/api';
import { isLookEmpty } from '../shared/cosmetics';
import { cachedJson } from './cache';
import type { Env } from './env';

/** seconds a board snapshot / total may be served from the edge cache */
export const BOARD_TTL_S = 20;

/**
 * 1 + players ahead of `s` (higher score, or same score reached earlier). Two range counts instead of one `a OR b`, so
 * each walks scores_rank from the top and reads only the rows ahead, not the whole board.
 */
const RANK = `(SELECT COUNT(*) FROM scores o WHERE o.board = ?1 AND o.period = ?2 AND o.score > s.score)
       + (SELECT COUNT(*) FROM scores o WHERE o.board = ?1 AND o.period = ?2 AND o.score = s.score AND o.achieved_at < s.achieved_at) + 1`;

/** `players.look` → the optional `look` field of a board row (absent when it is the default look) */
export function lookField(json: string | null | undefined): { look?: Look } {
  if (!json || json === '{}') return {};
  try {
    const look = sanitizeLook(JSON.parse(json));
    return isLookEmpty(look) ? {} : { look };
  } catch {
    return {};
  }
}

/** `players.pub` → the optional `pid` field of a board row */
export const pidField = (pub: string | null | undefined): { pid?: string } => (pub ? { pid: pub } : {});

export const periodKeyOf = (keys: PeriodKeys, p: Period): string => (p === 'all' ? 'all' : p === 'week' ? keys.week : keys.day);

/**
 * `claimed`: for the ticketed path, only write the score if THIS request's claim UPDATE won (the ticket row now
 * carries our clientRunId), so a lost race on the ticket can't leave a score behind.
 */
export function upsertStmt(
  env: Env,
  board: string,
  period: string,
  playerId: string,
  score: number,
  achievedAt: number,
  runId: string,
  verified: number,
  claimed?: { ticket: string; clientRunId: string },
) {
  // a SELECT feeding ON CONFLICT needs a WHERE clause (SQLite parsing ambiguity)
  const guard = claimed ? 'WHERE EXISTS (SELECT 1 FROM runs WHERE id = ?8 AND client_run_id = ?9)' : 'WHERE true';
  return env.DB.prepare(
    `INSERT INTO scores (board, period, player_id, score, achieved_at, run_id, verified)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 ${guard}
     ON CONFLICT (board, period, player_id) DO UPDATE SET
       score = excluded.score, achieved_at = excluded.achieved_at,
       run_id = excluded.run_id, verified = excluded.verified
     WHERE excluded.score > scores.score`,
  ).bind(...(claimed ? [board, period, playerId, score, achievedAt, runId, verified, claimed.ticket, claimed.clientRunId] : [board, period, playerId, score, achievedAt, runId, verified]));
}

/** Player's current best per period (before/after an upsert). */
export async function bestsOf(env: Env, board: string, keys: PeriodKeys, playerId: string): Promise<Record<Period, number | null>> {
  const rows = await env.DB.batch<{ score: number }>(
    PERIODS.map((p) => env.DB.prepare('SELECT score FROM scores WHERE board = ?1 AND period = ?2 AND player_id = ?3').bind(board, periodKeyOf(keys, p), playerId)),
  );
  const out = {} as Record<Period, number | null>;
  PERIODS.forEach((p, i) => (out[p] = rows[i].results[0]?.score ?? null));
  return out;
}

/** Number of rows on a board. COUNT(*) reads every row, so it is shared through the edge cache for BOARD_TTL_S. */
export const cachedTotal = (env: Env, origin: string, board: string, period: string, waitUntil?: (p: Promise<unknown>) => void): Promise<number> =>
  cachedJson(origin, `total/${encodeURIComponent(board)}/${period}`, BOARD_TTL_S, () => total(env, board, period), waitUntil);

/** rank/best/total per period (improved filled by caller). `total` may lag by BOARD_TTL_S, but is never below `rank`. */
export async function ranksOf(
  env: Env,
  board: string,
  keys: PeriodKeys,
  playerId: string,
  origin: string,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Record<Period, Omit<RankInfo, 'improved'>>> {
  const [res, totals] = await Promise.all([
    env.DB.batch<{ score: number; rank: number }>(
      PERIODS.map((p) => env.DB.prepare(`SELECT s.score AS score, ${RANK} AS rank FROM scores s WHERE s.board = ?1 AND s.period = ?2 AND s.player_id = ?3`).bind(board, periodKeyOf(keys, p), playerId)),
    ),
    Promise.all(PERIODS.map((p) => cachedTotal(env, origin, board, periodKeyOf(keys, p), waitUntil))),
  ]);
  const out = {} as Record<Period, Omit<RankInfo, 'improved'>>;
  PERIODS.forEach((p, i) => {
    const mine = res[i].results[0];
    out[p] = { rank: mine?.rank ?? null, best: mine?.score ?? 0, total: Math.max(totals[i], mine?.rank ?? 0) };
  });
  return out;
}

export async function top(env: Env, board: string, period: string, limit: number, meId: string | null): Promise<BoardEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.score, s.achieved_at, s.player_id, s.verified, p.name, p.tag, p.title, p.look, p.pub
     FROM scores s JOIN players p ON p.id = s.player_id
     WHERE s.board = ?1 AND s.period = ?2
     ORDER BY s.score DESC, s.achieved_at ASC
     LIMIT ?3`,
  )
    .bind(board, period, limit)
    .all<{ score: number; achieved_at: number; player_id: string; verified: number; name: string; tag: string; title: string; look: string; pub: string | null }>();
  return results.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    tag: r.tag,
    title: r.title,
    score: r.score,
    achievedAt: r.achieved_at,
    isMe: meId !== null && r.player_id === meId,
    verified: r.verified === 1,
    ...lookField(r.look),
    ...pidField(r.pub),
  }));
}

export async function total(env: Env, board: string, period: string): Promise<number> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE board = ?1 AND period = ?2').bind(board, period).first<{ n: number }>();
  return r?.n ?? 0;
}

/** The caller's own entry (rank by score desc, achieved_at asc). */
export async function myEntry(env: Env, board: string, period: string, playerId: string): Promise<BoardEntry | null> {
  const r = await env.DB.prepare(
    `SELECT s.score, s.achieved_at, s.verified, p.name, p.tag, p.title, p.look, p.pub, ${RANK} AS rank
     FROM scores s JOIN players p ON p.id = s.player_id
     WHERE s.board = ?1 AND s.period = ?2 AND s.player_id = ?3`,
  )
    .bind(board, period, playerId)
    .first<{ score: number; achieved_at: number; verified: number; name: string; tag: string; title: string; look: string; pub: string | null; rank: number }>();
  if (!r) return null;
  return { rank: r.rank, name: r.name, tag: r.tag, title: r.title, score: r.score, achievedAt: r.achieved_at, isMe: true, verified: r.verified === 1, ...lookField(r.look), ...pidField(r.pub) };
}
