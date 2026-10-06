import { LIMITS, normalizeRecoveryCode, type RecoverResponse } from '../../../shared/api';
import { issueSession, parseDevice, saveMeta } from '../../../server/auth';
import { sha256Hex } from '../../../server/crypto';
import type { Env } from '../../../server/env';
import { byMethod, fail, isObj, json, readJson } from '../../../server/http';
import { ipLimit } from '../../../server/ratelimit';

export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    POST: async () => {
      await ipLimit(ctx, 'recover', LIMITS.recoverPerIpPerHour); // failed and successful attempts both count
      const { value } = await readJson(ctx.request, LIMITS.maxBodyBytes);
      const device = parseDevice(value);
      const raw = isObj(value) ? value.code : null;
      const code = typeof raw === 'string' && raw.length <= 64 ? normalizeRecoveryCode(raw) : null;
      if (!code) return fail('bad_request', 'Malformed code');
      const p = await ctx.env.DB.prepare('SELECT id, tag, created_at, status, recovery_created_at FROM players WHERE recovery_hash = ?1')
        .bind(await sha256Hex(code))
        .first<{ id: string; tag: string; created_at: number; status: number; recovery_created_at: number | null }>();
      if (!p || p.status === 2) return fail('unauthorized', 'Unknown code');
      const now = Date.now();
      const { token, stmt } = await issueSession(ctx.env, p.id, 'recovery', device, now);
      await stmt.run();
      const body: RecoverResponse = { playerId: p.id, token, tag: p.tag, createdAt: p.created_at, save: await saveMeta(ctx.env, p.id), recoveryCreatedAt: p.recovery_created_at ?? null };
      return json(body);
    },
  });
