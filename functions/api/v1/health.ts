import { byMethod, json } from '../../../server/http';
import type { Env } from '../../../server/env';

export const onRequest: PagesFunction<Env> = async (ctx) => byMethod(ctx.request, { GET: () => json({ ok: true, time: Date.now() }) });
