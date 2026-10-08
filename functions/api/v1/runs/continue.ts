import { LIMITS, type ContinueResponse } from '../../../../shared/api';
import { authenticate } from '../../../../server/auth';
import { continueRun } from '../../../../server/continues';
import type { Env } from '../../../../server/env';
import { byMethod, fail, isObj, json, readJson } from '../../../../server/http';

/** POST /runs/continue { ticket, n, via }: see server/continues.ts. The ticket rides in the body, never the URL. */
export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    POST: async () => {
      const me = await authenticate(ctx, true);
      const { value } = await readJson(ctx.request, LIMITS.maxBodyBytes);
      if (!isObj(value)) return fail('bad_request', 'Invalid body');
      const body: ContinueResponse = await continueRun(ctx.env.DB, me.id, value.ticket, value.n, value.via, { trustAds: ctx.env.ADS_SSV_BYPASS === '1' });
      return json(body);
    },
  });
