import { authenticate } from '../../../../../server/auth';
import type { Env } from '../../../../../server/env';
import { byMethod } from '../../../../../server/http';
import { parseProvider, unlink } from '../../../../../server/identity';

export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    DELETE: async () => {
      const provider = parseProvider(ctx.params.provider);
      const me = await authenticate(ctx, true);
      await unlink(ctx.env, me.id, provider);
      return new Response(null, { status: 204 });
    },
  });
