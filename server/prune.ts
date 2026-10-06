import { periodKeys } from '../shared/api';
import type { Env } from './env';

const DAY = 86_400_000;

/** Called with probability ~1/100 after a submit (inside waitUntil). */
export function shouldPrune(): boolean {
  return Math.random() < 0.01;
}

export async function maybePrune(env: Env, now = Date.now()): Promise<void> {
  const dayCut = periodKeys(now - 3 * DAY).day;
  const weekCut = periodKeys(now - 14 * DAY).week;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM scores WHERE period >= 'd' AND period < ?1").bind(dayCut),
    env.DB.prepare("DELETE FROM scores WHERE period >= 'w' AND period < ?1").bind(weekCut),
    env.DB.prepare('DELETE FROM runs WHERE created_at < ?1').bind(now - 30 * DAY),
    env.DB.prepare('DELETE FROM rate_limits WHERE bucket < ?1').bind(Math.floor(now / 3_600_000) - 2),
  ]);
}
