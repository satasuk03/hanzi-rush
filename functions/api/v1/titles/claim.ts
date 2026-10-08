import type { TitleClaimResponse } from '../../../../shared/api';
import { authenticate } from '../../../../server/auth';
import type { Env } from '../../../../server/env';
import { byMethod, json } from '../../../../server/http';
import { claimTitles } from '../../../../server/titles';

/** POST /titles/claim (no body): pays the Jade for titles the stored save already meets. See server/titles.ts. */
export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    POST: async () => {
      const me = await authenticate(ctx, true);
      const body: TitleClaimResponse = await claimTitles(ctx.env.DB, me.id);
      return json(body);
    },
  });
