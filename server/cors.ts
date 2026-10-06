import type { Env } from './env';

const PAGES_RE = /^https:\/\/([a-z0-9-]+\.)?hanzi-rush\.pages\.dev$/;

export function allowedOrigin(origin: string | null, env: Env): string | null {
  if (!origin) return null;
  const list = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes(origin) || PAGES_RE.test(origin)) return origin;
  return null;
}

export function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const o = allowedOrigin(origin, env);
  const h: Record<string, string> = { Vary: 'Origin' };
  if (o) h['Access-Control-Allow-Origin'] = o;
  return h;
}

export function preflight(origin: string | null, env: Env): Response {
  const h: Record<string, string> = {
    ...corsHeaders(origin, env),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  return new Response(null, { status: 204, headers: h });
}
