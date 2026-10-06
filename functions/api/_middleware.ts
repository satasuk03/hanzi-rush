import { ApiError, errorResponse, json } from '../../server/http';
import { corsHeaders, preflight } from '../../server/cors';
import { sha256Hex } from '../../server/crypto';
import type { Env } from '../../server/env';
import { clientIp, softLimit } from '../../server/ratelimit';

/** CORS + preflight, error -> JSON, per-isolate soft rate limit. Covers every /api/* route incl. the 404 catch-all. */
export const onRequest: PagesFunction<Env> = async (ctx) => {
  const req = ctx.request;
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return preflight(origin, ctx.env);

  let res: Response;
  try {
    const auth = req.headers.get('Authorization');
    softLimit(auth ? 't:' + (await sha256Hex(auth)) : 'ip:' + clientIp(req));
    res = await ctx.next();
  } catch (e) {
    if (e instanceof ApiError) res = errorResponse(e);
    else {
      console.error('unhandled', e);
      res = json({ error: { code: 'server_error', message: 'Internal error' } }, 500);
    }
  }
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(corsHeaders(origin, ctx.env))) (k === 'Vary' ? out.headers.append : out.headers.set).call(out.headers, k, v); // keep a handler's own Vary
  if (!out.headers.has('Cache-Control')) out.headers.set('Cache-Control', 'no-store');
  return out;
};
