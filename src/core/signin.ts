/**
 * Provider credentials for POST /auth/:provider (shared/api.ts SignInRequest). This module only talks to the
 * providers; cloud.signIn() does the server call and the save reconciliation.
 *   google      every platform (@capgo/capacitor-social-login): an ID token
 *   apple       iOS (native) and web (Apple JS popup): an ID token. Not offered on Android.
 *   play_games  Android only (native PlayGamesPlugin.java): a one-time server auth code
 * A provider is offered only when its client ids are in the build (VITE_GOOGLE_*, VITE_APPLE_*), see README.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { SignInProvider } from '../../shared/api';

interface PlayGamesPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  signIn(opts: { serverClientId: string }): Promise<{ serverAuthCode: string }>;
}
const PlayGames = registerPlugin<PlayGamesPlugin>('PlayGames');

const PLATFORM = Capacitor.getPlatform();
const env = import.meta.env;
const GOOGLE_WEB = env.VITE_GOOGLE_WEB_CLIENT_ID?.trim() ?? '';
const GOOGLE_IOS = env.VITE_GOOGLE_IOS_CLIENT_ID?.trim() ?? '';
const APPLE_WEB = env.VITE_APPLE_SERVICE_ID?.trim() ?? '';

/** the plugin's pending-login marker (oauth-popup-bridge OAUTH_STATE_KEY) */
const POPUP_PENDING = 'social_login_oauth_pending';

/** this window is a web sign-in popup that came back from the provider */
export function isSignInPopup(): boolean {
  try {
    if (Capacitor.isNativePlatform() || !localStorage.getItem(POPUP_PENDING)) return false;
    // Google's COOP can null window.opener, so the provider's answer in the URL counts too
    return !!window.opener || /[#&](id_token|access_token|error)=/.test('&' + location.hash.slice(1));
  } catch {
    return false;
  }
}

/** the user closed the provider's sheet / popup: not an error worth showing */
export class SignInCancelled extends Error {}

const configured: Record<SignInProvider, boolean> = {
  play_games: PLATFORM === 'android' && !!GOOGLE_WEB,
  google: PLATFORM === 'ios' ? !!GOOGLE_IOS && !!GOOGLE_WEB : !!GOOGLE_WEB,
  apple: PLATFORM === 'ios' || (PLATFORM === 'web' && !!APPLE_WEB),
};

let pgAvailable: Promise<boolean> | null = null;

/** providers this build can offer here, in display order */
export async function signInProviders(): Promise<SignInProvider[]> {
  const out: SignInProvider[] = [];
  if (configured.play_games) {
    pgAvailable ??= PlayGames.isAvailable().then((r) => r.available, () => false);
    if (await pgAvailable) out.push('play_games');
  }
  if (configured.google) out.push('google');
  if (configured.apple) out.push('apple');
  return out;
}

let ready: Promise<typeof import('@capgo/capacitor-social-login').SocialLogin> | null = null;

function socialLogin() {
  ready ??= import('@capgo/capacitor-social-login').then(async ({ SocialLogin }) => {
    await SocialLogin.initialize({
      ...(configured.google ? { google: { webClientId: GOOGLE_WEB, iOSClientId: GOOGLE_IOS || undefined, mode: 'online' as const } } : {}),
      ...(configured.apple ? { apple: PLATFORM === 'ios' ? { redirectUrl: '' } : { clientId: APPLE_WEB, redirectUrl: env.VITE_APPLE_REDIRECT_URL?.trim() || location.origin + '/' } } : {}),
    });
    return SocialLogin;
  });
  ready.catch(() => (ready = null));
  return ready;
}

const isCancel = (e: unknown): boolean => {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === 'USER_CANCELLED' || err?.code === 'CANCELLED') return true;
  return /cancel|closed|access_denied|1001/i.test(String(err?.message ?? e));
};

/** asks the provider for a credential. Throws SignInCancelled when the user backs out, Error otherwise. */
export async function getCredential(provider: SignInProvider): Promise<string> {
  try {
    if (provider === 'play_games') return (await PlayGames.signIn({ serverClientId: GOOGLE_WEB })).serverAuthCode;
    const SL = await socialLogin();
    if (provider === 'google') {
      const r = await SL.login({ provider: 'google', options: { scopes: ['openid'], prompt: 'select_account' } });
      const token = r.result.responseType === 'online' ? r.result.idToken : null;
      if (!token) throw new Error('Google returned no ID token');
      return token;
    }
    const r = await SL.login({ provider: 'apple', options: { scopes: [] } });
    if (!r.result.idToken) throw new Error('Apple returned no ID token');
    return r.result.idToken;
  } catch (e) {
    if (isCancel(e)) throw new SignInCancelled();
    throw e;
  }
}
