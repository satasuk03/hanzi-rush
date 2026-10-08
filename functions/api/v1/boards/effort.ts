import type { EffortResponse } from '../../../../shared/api';
import { serveBoard } from '../../../../server/boardRoute';
import { myEffort, topEffort, totalEffort } from '../../../../server/effort';
import type { Env } from '../../../../server/env';
import { byMethod } from '../../../../server/http';

/** GET /boards/effort: static route, wins over boards/[board].ts */
export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    GET: () =>
      serveBoard(
        ctx,
        {
          key: 'effort',
          shared: async (periodKey, limit) => {
            const [entries, n] = await Promise.all([topEffort(ctx.env, periodKey, limit, null), totalEffort(ctx.env, periodKey)]);
            return { entries, total: n };
          },
          mine: (periodKey, playerId) => myEffort(ctx.env, periodKey, playerId),
        },
        (page): EffortResponse => page,
      ),
  });
