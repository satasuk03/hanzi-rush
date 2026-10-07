import type { JadeStarterResponse } from '../../../../shared/api';
import { authenticate } from '../../../../server/auth';
import type { Env } from '../../../../server/env';
import { byMethod, json } from '../../../../server/http';
import { claimStarter } from '../../../../server/wallet';

export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    POST: async () => {
      const me = await authenticate(ctx, true);
      const body: JadeStarterResponse = await claimStarter(ctx.env.DB, me.id);
      return json(body);
    },
  });
