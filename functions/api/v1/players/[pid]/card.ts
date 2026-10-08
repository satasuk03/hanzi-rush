import { RECOVERY_ALPHABET, type PlayerCardResponse } from '../../../../../shared/api';
import { lookField } from '../../../../../server/boards';
import { parseCard } from '../../../../../server/card';
import type { Env } from '../../../../../server/env';
import { byMethod, fail, json } from '../../../../../server/http';

const PID_RE = new RegExp(`^[${RECOVERY_ALPHABET}]{8}$`);

/**
 * GET /players/:pid/card: the player card behind a board row. The answer never depends on who asks, so no auth is
 * read and it is publicly cacheable. Hidden (status ≠ 0) and "card off" players look the same as unknown ones.
 */
export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    GET: async () => {
      const raw = Array.isArray(ctx.params.pid) ? ctx.params.pid[0] : ctx.params.pid;
      const pid = (raw ?? '').toUpperCase();
      if (!PID_RE.test(pid)) return fail('not_found', 'No such player');
      const r = await ctx.env.DB.prepare('SELECT name, tag, title, look, card FROM players WHERE pub = ?1 AND status = 0 AND card_public = 1')
        .bind(pid)
        .first<{ name: string; tag: string; title: string; look: string; card: string | null }>();
      if (!r) return fail('not_found', 'No such player');
      const body: PlayerCardResponse = { pid, name: r.name, tag: r.tag, title: r.title, ...lookField(r.look), card: parseCard(r.card) };
      // No HTTP cache: the client keeps its own 60 s cache, and a card turned off must stop showing.
      return json(body, 200, { 'Cache-Control': 'no-store' });
    },
  });
