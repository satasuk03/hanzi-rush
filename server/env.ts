export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  IP_SALT: string;
  /** comma-separated AdMob ad unit ids (the number after '/') whose SSV callbacks are accepted; unset = any */
  ADMOB_AD_UNITS?: string;
  /** '1' in .dev.vars only: ad continues need no AdMob callback (test ads never call back) */
  ADS_SSV_BYPASS?: string;
}

export type Ctx = Parameters<PagesFunction<Env>>[0];
