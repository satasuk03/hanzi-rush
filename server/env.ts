export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  IP_SALT: string;
  /** comma-separated Google OAuth client ids accepted as an ID token `aud` (the web client); unset = Google sign-in off */
  GOOGLE_CLIENT_IDS?: string;
  /** comma-separated Apple `aud` values: the web Services ID; unset = Apple sign-in off */
  APPLE_CLIENT_IDS?: string;
}

export type Ctx = Parameters<PagesFunction<Env>>[0];
