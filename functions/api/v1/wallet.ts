import { authenticate } from '../../../server/auth';
import type { Env } from '../../../server/env';
import { byMethod, json } from '../../../server/http';
import { walletState } from '../../../server/wallet';

export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    GET: async () => {
      const me = await authenticate(ctx, true);
      return json(await walletState(ctx.env.DB, me.id));
    },
  });
