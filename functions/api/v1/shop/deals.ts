import { LIMITS } from '../../../../shared/api';
import { authenticate } from '../../../../server/auth';
import { buyDeal, dealState } from '../../../../server/deals';
import type { Env } from '../../../../server/env';
import { byMethod, fail, isObj, json, readJson } from '../../../../server/http';

/** GET /shop/deals: today's offer. POST /shop/deals { day, slot, ref }: buy one. See server/deals.ts. */
export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    GET: async () => {
      const me = await authenticate(ctx, true);
      return json(await dealState(ctx.env.DB, me.id));
    },
    POST: async () => {
      const me = await authenticate(ctx, true);
      const { value } = await readJson(ctx.request, LIMITS.maxBodyBytes);
      if (!isObj(value)) return fail('bad_request', 'Invalid body');
      return json(await buyDeal(ctx.env.DB, me.id, value.day, value.slot, value.ref));
    },
  });
