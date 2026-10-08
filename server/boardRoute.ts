import { LIMITS, PERIODS, periodKeys, type Period } from '../shared/api';
import { authenticate } from './auth';
import { BOARD_TTL_S, periodKeyOf } from './boards';
import { cachedJson } from './cache';
import type { Ctx } from './env';
import { fail, json } from './http';

interface Row {
  rank: number;
  isMe: boolean;
  pid?: string;
}

export interface BoardPage<E extends Row> {
  period: Period;
  periodKey: string;
  resetsAt: number | null;
  total: number;
  entries: E[];
  me: E | null;
  serverTime: number;
}

export interface BoardSource<E extends Row> {
  /** cache key prefix, unique per board */
  key: string;
  /** top `limit` rows (isMe false) and the row count: the same for every caller, so shared through the edge cache */
  shared: (periodKey: string, limit: number) => Promise<{ entries: E[]; total: number }>;
  /** the caller's own row, always fresh */
  mine: (periodKey: string, playerId: string) => Promise<E | null>;
}

/**
 * GET ?period=all|week|day&limit=N for a leaderboard. The top rows and total come from the edge cache (BOARD_TTL_S) for
 * everyone, signed in or not; only the caller's own row is a per-request query. isMe is set by matching `pid`.
 */
export async function serveBoard<E extends Row, B>(ctx: Ctx, src: BoardSource<E>, wrap: (page: BoardPage<E>) => B): Promise<Response> {
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
  const now = Date.now();
  const keys = periodKeys(now);
  const periodKey = periodKeyOf(keys, period);
  const me = await authenticate(ctx, false);
  const [shared, mine] = await Promise.all([
    cachedJson(url.origin, `${src.key}/${periodKey}/${limit}`, BOARD_TTL_S, () => src.shared(periodKey, limit), (p) => ctx.waitUntil(p)),
    me ? src.mine(periodKey, me.id) : Promise.resolve(null),
  ]);
  const page: BoardPage<E> = {
    period,
    periodKey,
    resetsAt: period === 'all' ? null : period === 'week' ? keys.weekResetsAt : keys.dayResetsAt,
    // the cached total can lag behind a brand-new row
    total: Math.max(shared.total, mine?.rank ?? 0),
    entries: me?.pub ? shared.entries.map((e) => (e.pid === me.pub ? { ...e, isMe: true } : e)) : shared.entries,
    me: mine,
    serverTime: now,
  };
  return json(wrap(page), 200, { 'Cache-Control': me ? 'private, max-age=5' : `public, max-age=${BOARD_TTL_S}`, Vary: 'Authorization' });
}
