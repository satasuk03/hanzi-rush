import { DAY_RE, LIMITS, type JadeDailyRequest, type JadeDailyResponse } from '../../../../shared/api';
import { authenticate } from '../../../../server/auth';
import type { Env } from '../../../../server/env';
import { byMethod, isObj, json, readJson } from '../../../../server/http';
import { claimDaily } from '../../../../server/wallet';

export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    POST: async () => {
      const me = await authenticate(ctx, true);
      // the body is optional: an empty one means "today"
      let req: JadeDailyRequest = {};
      if ((await ctx.request.clone().text()).trim()) {
        const { value } = await readJson(ctx.request, LIMITS.maxBodyBytes);
        if (isObj(value) && typeof value.day === 'string' && DAY_RE.test(value.day)) req = { day: value.day };
      }
      const body: JadeDailyResponse = await claimDaily(ctx.env.DB, me.id, req.day);
      return json(body);
    },
  });
