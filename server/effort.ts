import type { EffortEntry, PeriodKeys } from '../shared/api';
import { PERIODS } from '../shared/api';
import { lookField, periodKeyOf, pidField } from './boards';
import type { Env } from './env';

export interface EffortRun {
  correct: number;
  asked: number;
  durationMs: number;
}

/**
 * One upsert per period, meant to sit IMMEDIATELY after the run-claim statement in the submit batch: each is guarded
 * by changes() > 0, so a claim that lost a race (0 rows) credits nothing, and each upsert's own change keeps the
 * chain going for the next one.
 */
export function effortStmts(env: Env, keys: PeriodKeys, playerId: string, run: EffortRun, now: number) {
  return PERIODS.map((p) =>
    env.DB.prepare(
      `INSERT INTO effort (period, player_id, correct, asked, runs, duration_ms, updated_at)
       SELECT ?1, ?2, ?3, ?4, 1, ?5, ?6 WHERE changes() > 0
       ON CONFLICT (period, player_id) DO UPDATE SET
         correct = correct + excluded.correct, asked = asked + excluded.asked, runs = runs + 1,
         duration_ms = duration_ms + excluded.duration_ms, updated_at = excluded.updated_at`,
    ).bind(periodKeyOf(keys, p), playerId, run.correct, run.asked, run.durationMs, now),
  );
}

interface Row {
  correct: number;
  runs: number;
  duration_ms: number;
  updated_at: number;
  player_id: string;
  name: string;
  tag: string;
  title: string;
  look: string;
  pub: string | null;
}

const entry = (r: Row, rank: number, meId: string | null): EffortEntry => ({
  rank,
  name: r.name,
  tag: r.tag,
  title: r.title,
  correct: r.correct,
  runs: r.runs,
  durationMs: r.duration_ms,
  isMe: meId !== null && r.player_id === meId,
  ...lookField(r.look),
  ...pidField(r.pub),
});

/** shadow-banned players (status 1) never get an effort row (see runs/index.ts), so no status filter is needed here */
export async function topEffort(env: Env, period: string, limit: number, meId: string | null): Promise<EffortEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT e.correct, e.runs, e.duration_ms, e.updated_at, e.player_id, p.name, p.tag, p.title, p.look, p.pub
     FROM effort e JOIN players p ON p.id = e.player_id
     WHERE e.period = ?1 AND p.status = 0
     ORDER BY e.correct DESC, e.updated_at ASC
     LIMIT ?2`,
  )
    .bind(period, limit)
    .all<Row>();
  return results.map((r, i) => entry(r, i + 1, meId));
}

export async function totalEffort(env: Env, period: string): Promise<number> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM effort WHERE period = ?1').bind(period).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function myEffort(env: Env, period: string, playerId: string): Promise<EffortEntry | null> {
  const r = await env.DB.prepare(
    `SELECT e.correct, e.runs, e.duration_ms, e.updated_at, e.player_id, p.name, p.tag, p.title, p.look, p.pub,
       (SELECT COUNT(*) + 1 FROM effort o JOIN players op ON op.id = o.player_id
          WHERE o.period = ?1 AND op.status = 0
            AND (o.correct > e.correct OR (o.correct = e.correct AND o.updated_at < e.updated_at))) AS rank
     FROM effort e JOIN players p ON p.id = e.player_id
     WHERE e.period = ?1 AND e.player_id = ?2`,
  )
    .bind(period, playerId)
    .first<Row & { rank: number }>();
  return r ? entry(r, r.rank, playerId) : null;
}
