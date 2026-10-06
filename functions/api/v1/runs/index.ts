import {
  LIMITS,
  PERIODS,
  SCORING,
  SUPPORTED_SCORING,
  checkRun,
  minDurationMs,
  parseBoardKey,
  periodKeys,
  sanitizeName,
  sanitizeTitle,
  type Period,
  type RankInfo,
  type SubmitRunResponse,
} from '../../../../shared/api';
import { authenticate, type Player } from '../../../../server/auth';
import { bestsOf, periodKeyOf, ranksOf, upsertStmt } from '../../../../server/boards';
import { uuid } from '../../../../server/crypto';
import type { Ctx, Env } from '../../../../server/env';
import { byMethod, fail, json, readJson } from '../../../../server/http';
import { effortStmts } from '../../../../server/effort';
import { maybePrune, shouldPrune } from '../../../../server/prune';
import { validateSubmit } from '../../../../server/validate';

interface RunRow {
  id: string;
  player_id: string;
  board: string;
  created_at: number;
  status: string;
  reason: string | null;
  verified: number;
  score: number | null;
}

const rankResponse = async (ctx: Ctx, me: Player, board: string, t: number, verified: boolean, improvedBy: Record<Period, boolean>) => {
  const keys = periodKeys(t);
  const ranks = await ranksOf(ctx.env, board, keys, me.id);
  const out = {} as Record<Period, RankInfo>;
  for (const p of PERIODS) out[p] = { ...ranks[p], improved: improvedBy[p] };
  const body: SubmitRunResponse = { accepted: true, verified, ranks: out };
  return json(body);
};

const noImprove: Record<Period, boolean> = { all: false, week: false, day: false };

export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    POST: async () => {
      const me = await authenticate(ctx, true);
      const { value } = await readJson(ctx.request, LIMITS.maxBodyBytes);
      const req = validateSubmit(value);
      if (!SUPPORTED_SCORING.includes(req.scoring)) return fail('unsupported_version', 'Unsupported scoring version');
      const db = ctx.env.DB;
      const now = Date.now();

      // 2. idempotency
      const prev = await db
        .prepare('SELECT id, player_id, board, created_at, status, reason, verified, score FROM runs WHERE player_id = ?1 AND client_run_id = ?2')
        .bind(me.id, req.clientRunId)
        .first<RunRow>();
      if (prev) {
        if (prev.status === 'rejected') return fail('implausible', 'Run rejected', { reason: prev.reason ?? 'rejected' });
        return rankResponse(ctx, me, prev.board, prev.created_at, prev.verified === 1, noImprove);
      }

      // 3. plausibility
      const bad = checkRun(req, req.ticket !== null);
      if (bad) {
        await db
          .prepare(
            `INSERT INTO runs (id, player_id, board, created_at, client_run_id, submitted_at, score, correct, asked, max_combo, duration_ms, verified, status, reason)
             VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?6, ?7, ?8, ?9, ?10, 0, 'rejected', ?11) ON CONFLICT DO NOTHING`,
          )
          .bind(uuid(), me.id, req.board, now, req.clientRunId, req.score, req.correct, req.asked, req.maxCombo, req.durationMs, bad)
          .run();
        return fail('implausible', 'Run failed plausibility check', { reason: bad });
      }
      const parsed = parseBoardKey(req.board)!;

      let t = now;
      let verified = 0;
      const runId = req.ticket ?? uuid();
      let claim;
      if (req.ticket !== null) {
        // 4. ticketed
        const tk = await db.prepare('SELECT id, player_id, board, created_at, status, reason, verified, score FROM runs WHERE id = ?1').bind(req.ticket).first<RunRow>();
        if (!tk || tk.player_id !== me.id || tk.board !== req.board || tk.status !== 'open' || now - tk.created_at > LIMITS.ticketTtlMs) {
          return fail('ticket_invalid', 'Ticket is not valid for this run');
        }
        // The ticket was requested after the run started, so a server-measured duration below the floor means
        // the ticket arrived late (slow network at run start), not that the run is fake. Still claim the ticket
        // (it must not be reusable) but rank the run as unverified.
        const tooFast = now - tk.created_at < minDurationMs(parsed.game, req.asked) * SCORING.durationSlack;
        if (!tooFast) {
          t = tk.created_at;
          verified = 1;
        }
        claim = db
          .prepare(
            `UPDATE runs SET client_run_id = ?1, submitted_at = ?2, score = ?3, correct = ?4, asked = ?5, max_combo = ?6, duration_ms = ?7, verified = ?10, status = 'ok'
             WHERE id = ?8 AND player_id = ?9 AND status = 'open'`,
          )
          .bind(req.clientRunId, now, req.score, req.correct, req.asked, req.maxCombo, req.durationMs, req.ticket, me.id, verified);
      } else {
        // 5. ticketless
        const dayStart = periodKeys(now).dayResetsAt - 86_400_000;
        const c = await db
          .prepare("SELECT COUNT(*) AS n FROM runs WHERE player_id = ?1 AND board = ?2 AND created_at >= ?3 AND verified = 0 AND status <> 'open'")
          .bind(me.id, req.board, dayStart)
          .first<{ n: number }>();
        if ((c?.n ?? 0) >= LIMITS.unverifiedRunsPerDay) {
          return fail('rate_limited', 'Too many unverified runs today', { retryAfter: Math.ceil((periodKeys(now).dayResetsAt - now) / 1000) });
        }
        claim = db
          .prepare(
            `INSERT INTO runs (id, player_id, board, created_at, client_run_id, submitted_at, score, correct, asked, max_combo, duration_ms, verified, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?6, ?7, ?8, ?9, ?10, 0, 'ok') ON CONFLICT DO NOTHING`,
          )
          .bind(uuid(), me.id, req.board, now, req.clientRunId, req.score, req.correct, req.asked, req.maxCombo, req.durationMs);
      }

      const keys = periodKeys(t);
      const before = me.status === 0 ? await bestsOf(ctx.env, req.board, keys, me.id) : null;
      const stmts = [claim];
      // effort counts verified runs only (a server-measured duration backs the answer count); must follow the claim directly
      if (me.status === 0 && verified === 1) stmts.push(...effortStmts(ctx.env, periodKeys(now), me.id, req, now));
      if (req.profile) {
        stmts.push(db.prepare('UPDATE players SET name = ?1, title = ?2 WHERE id = ?3').bind(sanitizeName(req.profile.name), sanitizeTitle(req.profile.title), me.id));
      }
      if (me.status === 0) {
        for (const p of PERIODS) stmts.push(upsertStmt(ctx.env, req.board, periodKeyOf(keys, p), me.id, req.score, t, runId, verified, req.ticket !== null ? { ticket: req.ticket, clientRunId: req.clientRunId } : undefined));
      }
      const res = await db.batch(stmts);
      if (res[0].meta.changes === 0) {
        // lost a race (same ticket or same clientRunId submitted concurrently)
        if (req.ticket !== null) return fail('ticket_invalid', 'Ticket already used');
      }

      if (shouldPrune()) ctx.waitUntil(maybePrune(ctx.env, now).catch(() => undefined));

      const improved = {} as Record<Period, boolean>;
      for (const p of PERIODS) improved[p] = before !== null && (before[p] === null || req.score > before[p]!);
      return rankResponse(ctx, me, req.board, t, verified === 1, improved);
    },
  });
