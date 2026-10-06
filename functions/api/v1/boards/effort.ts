import { LIMITS, PERIODS, periodKeys, type EffortResponse, type Period } from '../../../../shared/api';
import { authenticate } from '../../../../server/auth';
import { periodKeyOf } from '../../../../server/boards';
import { myEffort, topEffort, totalEffort } from '../../../../server/effort';
import type { Env } from '../../../../server/env';
import { byMethod, fail, json } from '../../../../server/http';

const BOARD_TTL_S = 20;

/** GET /boards/effort: static route, wins over boards/[board].ts */
export const onRequest: PagesFunction<Env> = async (ctx) =>
  byMethod(ctx.request, {
    GET: async () => {
      const url = new URL(ctx.request.url);
      const period = (url.searchParams.get('period') ?? 'all') as Period;
      if (!PERIODS.includes(period)) return fail('bad_request', 'Bad period');
      const limRaw = url.searchParams.get('limit');
      let limit: number = LIMITS.boardDefault;
      if (limRaw !== null) {
        if (!/^\d{1,4}$/.test(limRaw)) return fail('bad_request', 'Bad limit');
        limit = Number(limRaw);
        if (limit < 1 || limit > LIMITS.boardMax) return fail('bad_request', 'Bad limit');
      }
      const cache = typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null;
      const cacheKey = new Request(url.toString(), { method: 'GET' });
      const anon = !ctx.request.headers.get('Authorization');
      if (anon && cache) {
        const hit = await cache.match(cacheKey);
        if (hit) return hit;
      }
      const me = await authenticate(ctx, false);
      const now = Date.now();
      const keys = periodKeys(now);
      const periodKey = periodKeyOf(keys, period);
      const [entries, n, mine] = await Promise.all([
        topEffort(ctx.env, periodKey, limit, me?.id ?? null),
        totalEffort(ctx.env, periodKey),
        me ? myEffort(ctx.env, periodKey, me.id) : Promise.resolve(null),
      ]);
      const body: EffortResponse = {
        period,
        periodKey,
        resetsAt: period === 'all' ? null : period === 'week' ? keys.weekResetsAt : keys.dayResetsAt,
        total: n,
        entries,
        me: mine,
        serverTime: now,
      };
      const res = json(body, 200, { 'Cache-Control': me ? 'private, max-age=5' : `public, max-age=${BOARD_TTL_S}`, Vary: 'Authorization' });
      if (!me && cache) ctx.waitUntil(cache.put(cacheKey, res.clone()).catch(() => undefined));
      return res;
    },
  });
