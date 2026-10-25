/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin. '' / unset = same-origin (web), 'off' = cloud features disabled */
  readonly VITE_API_BASE?: string;
  /** client build version sent as DeviceInfo.appVersion */
  readonly VITE_APP_VERSION?: string;
  /** Google OAuth web client id: Google sign-in */
  readonly VITE_GOOGLE_WEB_CLIENT_ID?: string;
  /** Apple Services ID (Sign in with Apple on the web) and its registered return URL (default: this origin + '/') */
  readonly VITE_APPLE_SERVICE_ID?: string;
  readonly VITE_APPLE_REDIRECT_URL?: string;
}
