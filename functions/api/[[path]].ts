import { fail } from '../../server/http';
import type { Env } from '../../server/env';

/** Unknown /api/* -> JSON 404 (stops the SPA fallback returning index.html). */
export const onRequest: PagesFunction<Env> = async () => fail('not_found', 'Unknown route');
