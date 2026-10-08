import { googleKeys, storeAdReward, verifyAdmobSsv } from '../../../../server/continues';
import type { Env } from '../../../../server/env';

/**
 * GET /ads/admob-ssv: AdMob's server-side verification callback for rewarded ads (set it on the ad unit in the AdMob
 * console). Google signs the query; a genuine reward is stored for POST /runs/continue to claim. AdMob retries until
 * it sees a 200, and the "Verify URL" button in the console sends a callback without custom data (answered 200).
 */
export const onRequest: PagesFunction<Env> = async (ctx) => {
  if (ctx.request.method !== 'GET') return new Response(null, { status: 405 });
  const query = new URL(ctx.request.url).search.slice(1);
  if (!query) return new Response('ok'); // the console's reachability check
  const units = (ctx.env.ADMOB_AD_UNITS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const r = await verifyAdmobSsv(query, googleKeys, units);
  if (!r) return new Response('invalid', { status: 400 });
  await storeAdReward(ctx.env.DB, r);
  return new Response('ok');
};
