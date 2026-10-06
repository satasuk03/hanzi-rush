export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  IP_SALT: string;
}

export type Ctx = Parameters<PagesFunction<Env>>[0];
