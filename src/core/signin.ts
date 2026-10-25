/**
 * Provider credentials for POST /auth/:provider (shared/api.ts SignInRequest). This module only talks to the
 * providers; cloud.signIn() does the server call and the save reconciliation.
 *   google      Google popup (@capgo/capacitor-social-login): an ID token
 *   apple       Apple JS popup (same plugin): an ID token
 * A provider is offered only when its client ids are in the build (VITE_GOOGLE_*, VITE_APPLE_*), see README.
 */
import type { SignInProvider } from '../../shared/api';

const env = import.meta.env;
const GOOGLE_WEB = env.VITE_GOOGLE_WEB_CLIENT_ID?.trim() ?? '';
const APPLE_WEB = env.VITE_APPLE_SERVICE_ID?.trim() ?? '';

/** the plugin's pending-login marker (oauth-popup-bridge OAUTH_STATE_KEY) */
const POPUP_PENDING = 'social_login_oauth_pending';

/** this window is a web sign-in popup that came back from the provider */
export function isSignInPopup(): boolean {
  try {
    if (!localStorage.getItem(POPUP_PENDING)) return false;
    // Google's COOP can null window.opener, so the provider's answer in the URL counts too
    return !!window.opener || /[#&](id_token|access_token|error)=/.test('&' + location.hash.slice(1));
  } catch {
    return false;
  }
}

/** the user closed the provider's sheet / popup: not an error worth showing */
export class SignInCancelled extends Error {}

const configured: Record<SignInProvider, boolean> = {
  google: !!GOOGLE_WEB,
  apple: !!APPLE_WEB,
};

/** providers this build can offer here, in display order */
export async function signInProviders(): Promise<SignInProvider[]> {
  const out: SignInProvider[] = [];
  if (configured.google) out.push('google');
  if (configured.apple) out.push('apple');
  return out;
}

let ready: Promise<typeof import('@capgo/capacitor-social-login').SocialLogin> | null = null;

function socialLogin() {
  ready ??= import('@capgo/capacitor-social-login').then(async ({ SocialLogin }) => {
    await SocialLogin.initialize({
      ...(configured.google ? { google: { webClientId: GOOGLE_WEB, mode: 'online' as const } } : {}),
      ...(configured.apple ? { apple: { clientId: APPLE_WEB, redirectUrl: env.VITE_APPLE_REDIRECT_URL?.trim() || location.origin + '/' } } : {}),
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
