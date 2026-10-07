import { LIMITS, sanitizeLook, sanitizeName, sanitizeTitle, type PatchProfileResponse } from '../../../../shared/api';
import { authenticate } from '../../../../server/auth';
import { lookField } from '../../../../server/boards';
import { ownedLook } from '../../../../server/inventory';
import type { Env } from '../../../../server/env';
import { byMethod, fail, isObj, json, readJson } from '../../../../server/http';
import { validateLook } from '../../../../server/validate';

/**
 * PATCH /me/profile { name?, title?, look? }: push the display identity right away (the run and save piggybacks only
 * carry it with the next run or sync). Rate limited by players.profile_at, claimed in the same statement as the write.
 */
export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    PATCH: async () => {
      const me = await authenticate(ctx, true);
      const { value } = await readJson(ctx.request, LIMITS.maxBodyBytes);
      if (!isObj(value)) return fail('bad_request', 'Invalid body');
      const sets: string[] = [];
      const args: unknown[] = [];
      if (value.name !== undefined) {
        if (typeof value.name !== 'string' || value.name.length > 128) return fail('bad_request', 'Invalid name');
        sets.push(`name = ?${args.push(sanitizeName(value.name))}`);
      }
      if (value.title !== undefined) {
        if (typeof value.title !== 'string' || value.title.length > 64) return fail('bad_request', 'Invalid title');
        sets.push(`title = ?${args.push(sanitizeTitle(value.title))}`);
      }
      if (value.look !== undefined) {
        validateLook(value.look, 'look');
        sets.push(`look = ?${args.push(JSON.stringify(await ownedLook(ctx.env.DB, me.id, sanitizeLook(value.look))))}`);
      }
      if (!sets.length) return fail('bad_request', 'Nothing to update');

      const now = Date.now();
      const db = ctx.env.DB;
      const upd = await db
        .prepare(`UPDATE players SET ${sets.join(', ')}, profile_at = ?${args.length + 1} WHERE id = ?${args.length + 2} AND (profile_at IS NULL OR profile_at <= ?${args.length + 3})`)
        .bind(...args, now, me.id, now - LIMITS.profileMinIntervalSec * 1000)
        .run();
      if (upd.meta.changes === 0) return fail('rate_limited', 'Slow down', { retryAfter: LIMITS.profileMinIntervalSec });

      const p = await db.prepare('SELECT name, title, look FROM players WHERE id = ?1').bind(me.id).first<{ name: string; title: string; look: string }>();
      if (!p) return fail('unauthorized', 'Account not found');
      const body: PatchProfileResponse = { name: p.name, title: p.title, look: lookField(p.look).look ?? {} };
      return json(body);
    },
  });
