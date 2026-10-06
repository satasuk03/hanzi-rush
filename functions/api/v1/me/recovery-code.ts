import { LIMITS, RECOVERY_ALPHABET, RECOVERY_LEN, formatRecoveryCode, type RecoveryCodeResponse } from '../../../../shared/api';
import { authenticate } from '../../../../server/auth';
import { randomCode, sha256Hex } from '../../../../server/crypto';
import type { Env } from '../../../../server/env';
import { byMethod, isObj, json, readJson } from '../../../../server/http';
import { minInterval } from '../../../../server/ratelimit';

export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    POST: async () => {
      const me = await authenticate(ctx, true);
      // body is optional; only `signOutOthers` is read
      let signOutOthers = false;
      if (ctx.request.headers.get('Content-Length') !== '0') {
        const { value } = await readJson(ctx.request, LIMITS.maxBodyBytes).catch(() => ({ value: null }));
        signOutOthers = isObj(value) && value.signOutOthers === true;
      }
      const row = await ctx.env.DB.prepare('SELECT recovery_created_at AS t FROM players WHERE id = ?1').bind(me.id).first<{ t: number | null }>();
      const now = Date.now();
      minInterval(row?.t, 10_000, now);
      const code = randomCode(RECOVERY_ALPHABET, RECOVERY_LEN);
      const db = ctx.env.DB;
      const stmts = [db.prepare('UPDATE players SET recovery_hash = ?1, recovery_created_at = ?2 WHERE id = ?3').bind(await sha256Hex(code), now, me.id)];
      if (signOutOthers) stmts.push(db.prepare('DELETE FROM sessions WHERE player_id = ?1 AND token_hash <> ?2').bind(me.id, me.tokenHash));
      await db.batch(stmts);
      const body: RecoveryCodeResponse = { code: formatRecoveryCode(code), createdAt: now };
      return json(body);
    },
  });
