/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin. '' / unset = same-origin (web), 'off' = cloud features disabled */
  readonly VITE_API_BASE?: string;
  /** client build version sent as DeviceInfo.appVersion */
  readonly VITE_APP_VERSION?: string;
  /** AdMob rewarded ad unit ids (ca-app-pub-…/…). Unset = no ads in a production build (src/core/ads.ts) */
  readonly VITE_ADMOB_REWARDED_IOS?: string;
  readonly VITE_ADMOB_REWARDED_ANDROID?: string;
  /** '1' = use Google's test ad units even in a production build (testing on a phone) */
  readonly VITE_ADMOB_TEST?: string;
  /** Google OAuth web client id: Google sign-in on web/Android, and the server client id for Play Games codes */
  readonly VITE_GOOGLE_WEB_CLIENT_ID?: string;
  /** Google OAuth iOS client id (Google sign-in on iOS) */
  readonly VITE_GOOGLE_IOS_CLIENT_ID?: string;
  /** Apple Services ID (Sign in with Apple on the web) and its registered return URL (default: this origin + '/') */
  readonly VITE_APPLE_SERVICE_ID?: string;
  readonly VITE_APPLE_REDIRECT_URL?: string;
}
