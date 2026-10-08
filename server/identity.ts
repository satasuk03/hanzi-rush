/**
 * Linked sign-in providers (identities table, docs/backend.md §2). POST /auth/:provider calls `signInOrLink` once the
 * credential is verified (server/oidc.ts); this file only touches D1, so it is testable without any provider.
 */
import { SIGNIN_PROVIDERS, type DeviceInfo, type SignInProvider, type SignInResponse } from '../shared/api';
import { issueSession, saveMeta, type Player } from './auth';
import type { Env } from './env';
import { fail } from './http';
import type { VerifiedIdentity } from './oidc';

/** the `:provider` route param; anything else is a 404 */
export function parseProvider(p: string | string[] | undefined): SignInProvider {
  const s = Array.isArray(p) ? p[0] : p;
  return SIGNIN_PROVIDERS.includes(s as SignInProvider) ? (s as SignInProvider) : fail('not_found', 'Unknown provider');
}

interface Linked {
  player_id: string;
  created_at: number;
  status: number;
  tag: string;
  p_created_at: number;
  recovery_created_at: number | null;
}

const findLinked = (env: Env, provider: SignInProvider, subject: string) =>
  env.DB.prepare(
    'SELECT i.player_id, i.created_at, p.status, p.tag, p.created_at AS p_created_at, p.recovery_created_at FROM identities i JOIN players p ON p.id = i.player_id WHERE i.provider = ?1 AND i.subject = ?2',
  )
    .bind(provider, subject)
    .first<Linked>();

/**
 * Already linked → a session for that player (or `linked` when it is the caller). Not linked → link it to the caller.
 * `caller` null = no (valid) token: an unknown provider account is a 404, never a new player.
 */
export async function signInOrLink(env: Env, caller: Player | null, provider: SignInProvider, id: VerifiedIdentity, device: DeviceInfo, now: number): Promise<SignInResponse> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await findLinked(env, provider, id.subject);
    if (row) {
      if (row.status === 2) return fail('unauthorized', 'This account is disabled');
      if (caller && row.player_id === caller.id) return { result: 'linked', provider, linkedAt: row.created_at };
      const { token, stmt } = await issueSession(env, row.player_id, provider, device, now);
      await stmt.run();
      return {
        result: 'signedIn',
        auth: { playerId: row.player_id, token, tag: row.tag, createdAt: row.p_created_at, save: await saveMeta(env, row.player_id), recoveryCreatedAt: row.recovery_created_at ?? null },
      };
    }
    if (!caller) return fail('not_found', 'No account is linked to this sign-in');
    try {
      await env.DB.prepare('INSERT INTO identities (provider, subject, player_id, created_at) VALUES (?1, ?2, ?3, ?4)').bind(provider, id.subject, caller.id, now).run();
      return { result: 'linked', provider, linkedAt: now };
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e;
      // (player_id, provider) taken: the caller already linked another account of this provider
      const mine = await env.DB.prepare('SELECT subject FROM identities WHERE player_id = ?1 AND provider = ?2').bind(caller.id, provider).first<{ subject: string }>();
      if (mine && mine.subject !== id.subject) return fail('identity_conflict', 'Another account of this provider is already linked', { reason: 'provider_linked' });
      // (provider, subject) taken by a concurrent link: go round once more and sign in to whoever won
    }
  }
  return fail('server_error', 'Could not link the account');
}

export async function unlink(env: Env, playerId: string, provider: SignInProvider): Promise<void> {
  await env.DB.prepare('DELETE FROM identities WHERE player_id = ?1 AND provider = ?2').bind(playerId, provider).run();
}
