import { LIMITS, type ShopPullResponse } from '../../../../shared/api';
import { authenticate } from '../../../../server/auth';
import type { Env } from '../../../../server/env';
import { byMethod, fail, isObj, json, readJson } from '../../../../server/http';
import { pull } from '../../../../server/shop';

/** POST /shop/pull { box, qty, ref }: see server/shop.ts. Banned accounts are rejected by authenticate(). */
export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    POST: async () => {
      const me = await authenticate(ctx, true);
      const { value } = await readJson(ctx.request, LIMITS.maxBodyBytes);
      if (!isObj(value)) return fail('bad_request', 'Invalid body');
      const body: ShopPullResponse = await pull(ctx.env.DB, me.id, value.box, value.qty, value.ref);
      return json(body);
    },
  });
