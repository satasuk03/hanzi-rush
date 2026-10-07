import type { AuthResponse, DeviceInfo, Platform } from '../shared/api';
import { RECOVERY_ALPHABET } from '../shared/api';
import { randomCode, randomToken, sha256Hex } from './crypto';
import type { Ctx, Env } from './env';
import { fail, isObj } from './http';

export interface Player {
  id: string;
  tag: string;
  status: number;
  tokenHash: string;
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('Authorization');
  if (!h) return null;
  const m = /^Bearer (hr1\.[A-Za-z0-9_-]{20,64})$/.exec(h);
  return m ? m[1] : null;
}

/** Returns the authenticated player, or null when optional and missing/invalid. Throws 401 when required. */
export async function authenticate(ctx: Ctx, required: true): Promise<Player>;
export async function authenticate(ctx: Ctx, required: false): Promise<Player | null>;
export async function authenticate(ctx: Ctx, required: boolean): Promise<Player | null> {
  const token = bearer(ctx.request);
  if (!token) return required ? fail('unauthorized', 'Missing or malformed token') : null;
  const tokenHash = await sha256Hex(token);
  const row = await ctx.env.DB.prepare(
    'SELECT s.player_id AS id, p.status AS status, p.tag AS tag FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = ?1',
  )
    .bind(tokenHash)
    .first<{ id: string; status: number; tag: string }>();
  if (!row) return required ? fail('unauthorized', 'Invalid token') : null;
  if (row.status === 2) return required ? fail('banned', 'This account is disabled') : null;
  const now = Date.now();
  // at most one write per device per day
  ctx.waitUntil(
    ctx.env.DB.batch([
      ctx.env.DB.prepare('UPDATE sessions SET last_used_at = ?1 WHERE token_hash = ?2 AND last_used_at < ?1 - 86400000').bind(now, tokenHash),
      ctx.env.DB.prepare('UPDATE players SET last_seen_at = ?1 WHERE id = ?2 AND last_seen_at < ?1 - 86400000').bind(now, row.id),
    ]).then(
      () => undefined,
      () => undefined,
    ),
  );
  return { id: row.id, tag: row.tag, status: row.status, tokenHash };
}

export function parseDevice(x: unknown): DeviceInfo {
  if (!isObj(x) || !isObj(x.device)) return fail('bad_request', 'device required');
  const d = x.device;
  const platforms: Platform[] = ['web', 'ios', 'android'];
  if (typeof d.platform !== 'string' || !platforms.includes(d.platform as Platform)) return fail('bad_request', 'bad device.platform');
  if (typeof d.appVersion !== 'string' || d.appVersion.length > 32) return fail('bad_request', 'bad device.appVersion');
  return { platform: d.platform as Platform, appVersion: d.appVersion };
}

export const randomTag = (): string => randomCode(RECOVERY_ALPHABET, 4);

/** public id of a player (`players.pub`): 8 chars, unique, safe to show. Unrelated to players.id */
export const randomPub = (): string => randomCode(RECOVERY_ALPHABET, 8);

/** Builds the INSERT for a new session; returns the statement plus the clear token (shown once). */
export async function issueSession(env: Env, playerId: string, via: string, device: DeviceInfo, now: number) {
  const token = randomToken();
  const stmt = env.DB.prepare(
    'INSERT INTO sessions (token_hash, player_id, created_at, last_used_at, via, platform, app_version) VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6)',
  ).bind(await sha256Hex(token), playerId, now, via, device.platform, device.appVersion);
  return { token, stmt };
}

export async function saveMeta(env: Env, playerId: string): Promise<AuthResponse['save']> {
  const r = await env.DB.prepare('SELECT revision, updated_at FROM saves WHERE player_id = ?1').bind(playerId).first<{ revision: number; updated_at: number }>();
  return r ? { revision: r.revision, updatedAt: r.updated_at } : null;
}
