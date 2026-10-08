import { sha256Hex } from './crypto';
import type { Ctx } from './env';
import { fail } from './http';

export function clientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? 'unknown';
}

export const ipHash = (ctx: Ctx): Promise<string> => sha256Hex((ctx.env.IP_SALT ?? '') + clientIp(ctx.request));

/** Fixed-window per-IP-hash counter (hourly). Counts every attempt, then rejects when over `max`. */
export async function ipLimit(ctx: Ctx, kind: 'create' | 'recover' | 'signin', max: number): Promise<string> {
  const h = await ipHash(ctx);
  const now = Date.now();
  const bucket = Math.floor(now / 3_600_000);
  const row = await ctx.env.DB.prepare(
    'INSERT INTO rate_limits (key, bucket, count) VALUES (?1, ?2, 1) ON CONFLICT (key, bucket) DO UPDATE SET count = count + 1 RETURNING count',
  )
    .bind(`${kind}:${h}`, bucket)
    .first<{ count: number }>();
  if (row && row.count > max) {
    fail('rate_limited', 'Too many attempts, try again later', { retryAfter: Math.ceil(((bucket + 1) * 3_600_000 - now) / 1000) });
  }
  return h;
}

/** Fails with 429 if less than `minMs` has passed since `lastMs`. */
export function minInterval(lastMs: number | null | undefined, minMs: number, now = Date.now()): void {
  if (lastMs != null && now - lastMs < minMs) {
    fail('rate_limited', 'Slow down', { retryAfter: Math.ceil((minMs - (now - lastMs)) / 1000) });
  }
}

// best-effort per-isolate token bucket: 60 req/min per key
const WINDOW = 60_000;
const MAX = 60;
const hits = new Map<string, { start: number; n: number }>();

export function softLimit(key: string, now = Date.now()): void {
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now - v.start > WINDOW) hits.delete(k);
    if (hits.size > 5000) hits.clear();
  }
  const e = hits.get(key);
  if (!e || now - e.start > WINDOW) {
    hits.set(key, { start: now, n: 1 });
    return;
  }
  if (++e.n > MAX) fail('rate_limited', 'Too many requests', { retryAfter: Math.ceil((e.start + WINDOW - now) / 1000) });
}
