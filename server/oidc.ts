/**
 * Provider credential checks for POST /auth/:provider (docs/backend.md §2). Each returns the provider's stable user id.
 *  - google / apple: an OpenID Connect ID token, verified locally (RS256 signature against the provider's JWKS, iss,
 *    aud, exp). No secrets needed.
 *  - play_games: a one-time server auth code, exchanged with Google (needs the web client secret) for an access token,
 *    then GET games/v1/players/me gives the Play Games player id.
 */
import type { SignInProvider } from '../shared/api';
import type { Env } from './env';
import { fail } from './http';

/** only the provider's user id is kept: no email or profile (public/privacy.html) */
export interface VerifiedIdentity {
  subject: string;
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

const PROVIDERS = {
  google: { jwks: 'https://www.googleapis.com/oauth2/v3/certs', iss: ['https://accounts.google.com', 'accounts.google.com'] },
  apple: { jwks: 'https://appleid.apple.com/auth/keys', iss: ['https://appleid.apple.com'] },
} as const;

/** allowed clock skew on exp / iat */
const SKEW_S = 300;
const JWKS_TTL_MS = 3600_000;
const jwksCache = new Map<string, { at: number; keys: Jwk[] }>();

async function jwks(url: string, refresh = false): Promise<Jwk[]> {
  const hit = jwksCache.get(url);
  if (hit && !refresh && Date.now() - hit.at < JWKS_TTL_MS) return hit.keys;
  const res = await fetch(url);
  if (!res.ok) return fail('server_error', 'Could not fetch provider keys');
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(url, { at: Date.now(), keys });
  return keys;
}

const b64urlBytes = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

const csv = (v: string | undefined): string[] => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/**
 * Verifies an RS256 JWT. `getKeys(refresh)` supplies the JWKS (refresh = the kid was not found, keys may have rotated).
 * Exported for tests; throws 'unauthorized' on any failure.
 */
export async function verifyJwt(
  token: string,
  opts: { getKeys: (refresh: boolean) => Promise<Jwk[]>; issuers: readonly string[]; audiences: string[]; now?: number },
): Promise<Record<string, unknown>> {
  const bad = (why: string): never => fail('unauthorized', `Invalid ID token: ${why}`);
  const parts = token.split('.');
  if (parts.length !== 3) return bad('format');
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[1])));
  } catch {
    return bad('format');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return bad('alg');
  let jwk = (await opts.getKeys(false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await opts.getKeys(true)).find((k) => k.kid === header.kid);
  if (!jwk || jwk.kty !== 'RSA') return bad('unknown key');
  const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return bad('signature');
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (typeof claims.iss !== 'string' || !opts.issuers.includes(claims.iss)) return bad('iss');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.some((a) => typeof a === 'string' && opts.audiences.includes(a))) return bad('aud');
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < now) return bad('expired');
  if (typeof claims.iat === 'number' && claims.iat - SKEW_S > now) return bad('iat');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) return bad('sub');
  return claims;
}

async function verifyIdToken(provider: 'google' | 'apple', token: string, audiences: string[]): Promise<VerifiedIdentity> {
  if (!audiences.length) return fail('not_found', `${provider} sign-in is not configured`);
  const p = PROVIDERS[provider];
  const claims = await verifyJwt(token, { getKeys: (refresh) => jwks(p.jwks, refresh), issuers: p.iss, audiences });
  return { subject: claims.sub as string };
}

async function verifyPlayGames(env: Env, code: string): Promise<VerifiedIdentity> {
  if (!env.PLAY_GAMES_CLIENT_ID || !env.PLAY_GAMES_CLIENT_SECRET) return fail('not_found', 'Play Games sign-in is not configured');
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.PLAY_GAMES_CLIENT_ID, client_secret: env.PLAY_GAMES_CLIENT_SECRET, grant_type: 'authorization_code', redirect_uri: '' }),
  });
  if (tok.status >= 500) return fail('server_error', 'Google token endpoint failed');
  const t = (await tok.json().catch(() => null)) as { access_token?: string } | null;
  if (!tok.ok || !t?.access_token) return fail('unauthorized', 'Invalid Play Games auth code');
  const me = await fetch('https://games.googleapis.com/games/v1/players/me', { headers: { Authorization: `Bearer ${t.access_token}` } });
  if (!me.ok) return me.status >= 500 ? fail('server_error', 'Play Games API failed') : fail('unauthorized', 'Play Games rejected the token');
  const p = (await me.json().catch(() => null)) as { playerId?: string } | null;
  if (!p || typeof p.playerId !== 'string' || !p.playerId || p.playerId.length > 255) return fail('unauthorized', 'No Play Games player id');
  return { subject: p.playerId };
}

export function verifyCredential(env: Env, provider: SignInProvider, credential: string): Promise<VerifiedIdentity> {
  switch (provider) {
    case 'google':
      return verifyIdToken('google', credential, csv(env.GOOGLE_CLIENT_IDS));
    case 'apple':
      return verifyIdToken('apple', credential, csv(env.APPLE_CLIENT_IDS));
    case 'play_games':
      return verifyPlayGames(env, credential);
  }
}
