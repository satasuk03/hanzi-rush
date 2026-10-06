import { LIMITS, parseBoardKey, periodKeys, type StartRunResponse } from '../../../../shared/api';
import { authenticate } from '../../../../server/auth';
import { randomTicket } from '../../../../server/crypto';
import type { Env } from '../../../../server/env';
import { byMethod, fail, json, readJson } from '../../../../server/http';
import { minInterval } from '../../../../server/ratelimit';
import { validateBoardOnly } from '../../../../server/validate';

export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    POST: async () => {
      const me = await authenticate(ctx, true);
      const { value } = await readJson(ctx.request, LIMITS.maxBodyBytes);
      const board = validateBoardOnly(value);
      if (!parseBoardKey(board)) return fail('bad_request', 'Unknown board');
      const db = ctx.env.DB;
      const now = Date.now();
      const dayStart = periodKeys(now).dayResetsAt - 86_400_000;
      const [last, cnt] = await db.batch<{ t: number | null; n: number }>([
        db.prepare('SELECT MAX(created_at) AS t FROM runs WHERE player_id = ?1').bind(me.id),
        db.prepare('SELECT COUNT(*) AS n FROM runs WHERE player_id = ?1 AND board = ?2 AND created_at >= ?3').bind(me.id, board, dayStart),
      ]);
      minInterval(last.results[0]?.t, LIMITS.runStartMinIntervalSec * 1000, now);
      if ((cnt.results[0]?.n ?? 0) >= LIMITS.runsPerDay) {
        return fail('rate_limited', 'Daily run limit reached', { retryAfter: Math.ceil((periodKeys(now).dayResetsAt - now) / 1000) });
      }
      const ticket = randomTicket();
      await db.prepare("INSERT INTO runs (id, player_id, board, created_at, status) VALUES (?1, ?2, ?3, ?4, 'open')").bind(ticket, me.id, board, now).run();
      const body: StartRunResponse = { ticket, serverTime: now, expiresAt: now + LIMITS.ticketTtlMs };
      return json(body);
    },
  });
