import type { MeResponse } from '../../../shared/api';
import { authenticate, saveMeta } from '../../../server/auth';
import type { Env } from '../../../server/env';
import { byMethod, fail, json } from '../../../server/http';

export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    GET: async () => {
      const me = await authenticate(ctx, true);
      const db = ctx.env.DB;
      const p = await db
        .prepare('SELECT id, tag, name, title, created_at, recovery_hash IS NOT NULL AS has_code, recovery_created_at FROM players WHERE id = ?1')
        .bind(me.id)
        .first<{ id: string; tag: string; name: string; title: string; created_at: number; has_code: number; recovery_created_at: number | null }>();
      if (!p) return fail('unauthorized', 'Account not found');
      const ids = await db.prepare('SELECT provider, created_at FROM identities WHERE player_id = ?1').bind(me.id).all<{ provider: 'apple' | 'google' | 'email'; created_at: number }>();
      const body: MeResponse = {
        playerId: p.id,
        tag: p.tag,
        name: p.name,
        title: p.title,
        createdAt: p.created_at,
        save: await saveMeta(ctx.env, me.id),
        hasRecoveryCode: !!p.has_code,
        recoveryCreatedAt: p.recovery_created_at ?? null,
        identities: ids.results.map((r) => ({ provider: r.provider, linkedAt: r.created_at })),
      };
      return json(body);
    },
    DELETE: async () => {
      const me = await authenticate(ctx, true);
      const db = ctx.env.DB;
      // explicit child deletes as well as ON DELETE CASCADE, so deletion does not depend on FK enforcement
      await db.batch([
        db.prepare('DELETE FROM scores WHERE player_id = ?1').bind(me.id),
        db.prepare('DELETE FROM runs WHERE player_id = ?1').bind(me.id),
        db.prepare('DELETE FROM saves WHERE player_id = ?1').bind(me.id),
        db.prepare('DELETE FROM identities WHERE player_id = ?1').bind(me.id),
        db.prepare('DELETE FROM sessions WHERE player_id = ?1').bind(me.id),
        db.prepare('DELETE FROM players WHERE id = ?1').bind(me.id),
      ]);
      return new Response(null, { status: 204 });
    },
  });
