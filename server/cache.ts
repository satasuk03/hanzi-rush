/**
 * Short-lived JSON cache on the Cloudflare edge (Cache API), so hot reads that are the same for every player skip D1.
 * Per data center and best effort: a miss just computes. Keys live under the request's own origin (the Cache API only
 * stores URLs of this zone). Without `caches` (tests, node) it always computes.
 */
const edge = (): Cache | null => (typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null);

export async function cachedJson<T>(origin: string, key: string, ttlS: number, compute: () => Promise<T>, waitUntil?: (p: Promise<unknown>) => void): Promise<T> {
  const cache = edge();
  if (!cache) return compute();
  const req = new Request(new URL(`/__cache/${key}`, origin).toString(), { method: 'GET' });
  const hit = await cache.match(req).catch(() => undefined);
  if (hit) return (await hit.json()) as T;
  const value = await compute();
  const put = cache.put(req, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttlS}` } })).catch(() => undefined);
  if (waitUntil) waitUntil(put);
  else await put;
  return value;
}
