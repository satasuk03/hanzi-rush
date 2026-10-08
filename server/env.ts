export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  IP_SALT: string;
  /** comma-separated AdMob ad unit ids (the number after '/') whose SSV callbacks are accepted; unset = any */
  ADMOB_AD_UNITS?: string;
  /** '1' in .dev.vars only: ad continues need no AdMob callback (test ads never call back) */
  ADS_SSV_BYPASS?: string;
  /** comma-separated Google OAuth client ids accepted as an ID token `aud` (web client + iOS client); unset = Google sign-in off */
  GOOGLE_CLIENT_IDS?: string;
  /** comma-separated Apple `aud` values: the iOS bundle id and the web Services ID; unset = Apple sign-in off */
  APPLE_CLIENT_IDS?: string;
  /** Google web OAuth client that Play Games server auth codes are issued for; unset = Play Games sign-in off */
  PLAY_GAMES_CLIENT_ID?: string;
  /** secret: that client's secret (`npx wrangler pages secret put PLAY_GAMES_CLIENT_SECRET`) */
  PLAY_GAMES_CLIENT_SECRET?: string;
}

export type Ctx = Parameters<PagesFunction<Env>>[0];
