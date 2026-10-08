import { LIMITS, SAVE_FORMAT, type PutSaveRequest, type SaveDoc, type SubmitRunRequest } from '../shared/api';
import { fail, isObj } from './http';

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_NUM = 1e9;
/** cards[k][2] is epoch SECONDS (~1.8e9), which exceeds the doc's 1e9 cap, so it gets its own bound. */
const MAX_EPOCH_S = 1e10;

const bad = (what: string): never => fail('bad_request', `Invalid ${what}`);

function int(x: unknown, what: string, max = MAX_NUM): number {
  if (typeof x !== 'number' || !Number.isFinite(x) || !Number.isInteger(x) || x < 0 || x > max) return bad(what);
  return x;
}
function str(x: unknown, what: string, max: number): string {
  if (typeof x !== 'string' || x.length > max) return bad(what);
  return x;
}
function bool(x: unknown, what: string): boolean {
  if (typeof x !== 'boolean') return bad(what);
  return x;
}
function rec(x: unknown, what: string, maxKeys: number): Record<string, unknown> {
  if (!isObj(x)) return bad(what);
  if (Object.keys(x).length > maxKeys) return bad(what);
  return x;
}
function tuple(x: unknown, what: string, n: number, lastMax?: number): unknown[] {
  if (!Array.isArray(x) || x.length !== n) return bad(what);
  x.forEach((v, i) => int(v, what, i === n - 1 && lastMax ? lastMax : MAX_NUM));
  return x;
}

/** Shape only (≤16 keys, short strings, ≤8 badges): sanitizeLook() decides what is actually kept. */
export function validateLook(x: unknown, what: string): void {
  const l = rec(x, what, 16);
  for (const [k, v] of Object.entries(l)) {
    if (k === 'badges') {
      if (!Array.isArray(v) || v.length > 8) bad(`${what}.badges`);
      (v as unknown[]).forEach((b) => str(b, `${what}.badges`, 64));
    } else str(v, `${what}.${k}`, 64);
  }
}

/** Shape-only validation of a SaveDoc. Unknown extra keys are allowed (forward compat). */
export function validateSaveDoc(x: unknown): SaveDoc {
  if (!isObj(x)) return bad('data');
  if (x.v !== SAVE_FORMAT) {
    if (typeof x.v === 'number') return fail('unsupported_version', 'Unsupported save format');
    return bad('data.v');
  }
  const s = rec(x.settings, 'settings', 64);
  if (s.lang !== 'th' && s.lang !== 'en') bad('settings.lang');
  bool(s.sound, 'settings.sound');
  bool(s.pinyin, 'settings.pinyin');
  bool(s.voice, 'settings.voice');

  const p = rec(x.progress, 'progress', 64);
  for (const v of Object.values(rec(p.best, 'progress.best', 200))) int(v, 'progress.best');
  for (const k of Object.keys(p.best as object)) str(k, 'progress.best key', 64);
  const words = rec(p.words, 'progress.words', 6000);
  for (const [k, v] of Object.entries(words)) {
    str(k, 'word key', 64);
    tuple(v, 'progress.words', 2);
  }
  int(p.coins, 'progress.coins');
  int(p.xp, 'progress.xp');
  const cards = rec(p.cards, 'progress.cards', 6000);
  for (const [k, v] of Object.entries(cards)) {
    str(k, 'card key', 64);
    tuple(v, 'progress.cards', 3, MAX_EPOCH_S);
  }
  int(p.pity, 'progress.pity');

  const st = rec(p.stats, 'progress.stats', 64);
  for (const k of ['games', 'questions', 'correct', 'bestCombo', 'perfect', 'pulls', 'coinsEarned', 'coinsSpent', 'maxCoins']) int(st[k], `stats.${k}`);
  if (!Array.isArray(st.byRarity) || st.byRarity.length > 16) bad('stats.byRarity');
  (st.byRarity as unknown[]).forEach((v) => int(v, 'stats.byRarity'));

  const pr = rec(p.profile, 'progress.profile', 64);
  str(pr.name, 'profile.name', 128);
  str(pr.title, 'profile.title', 64);
  if (!Array.isArray(pr.seen) || pr.seen.length > 256) bad('profile.seen');
  (pr.seen as unknown[]).forEach((v) => str(v, 'profile.seen', 64));
  if (pr.look !== undefined) validateLook(pr.look, 'profile.look');

  const d = rec(p.daily, 'progress.daily', 64);
  str(d.last, 'daily.last', 16);
  for (const k of ['streak', 'best', 'total']) int(d[k], `daily.${k}`);

  return x as unknown as SaveDoc;
}

export function validatePutSave(x: unknown): PutSaveRequest {
  if (!isObj(x)) return bad('body');
  const baseRevision = int(x.baseRevision, 'baseRevision', Number.MAX_SAFE_INTEGER);
  if (typeof x.clientUpdatedAt !== 'number' || !Number.isFinite(x.clientUpdatedAt)) bad('clientUpdatedAt');
  const data = validateSaveDoc(x.data);
  if (x.pushId !== undefined && (typeof x.pushId !== 'string' || !ID_RE.test(x.pushId))) bad('pushId');
  return { baseRevision, data, clientUpdatedAt: Math.trunc(x.clientUpdatedAt as number), ...(x.pushId !== undefined ? { pushId: x.pushId as string } : {}) };
}

export function validateSubmit(x: unknown): SubmitRunRequest {
  if (!isObj(x)) return bad('body');
  if (typeof x.clientRunId !== 'string' || !ID_RE.test(x.clientRunId)) bad('clientRunId');
  if (x.ticket !== null && (typeof x.ticket !== 'string' || !ID_RE.test(x.ticket))) bad('ticket');
  str(x.board, 'board', 32);
  for (const k of ['score', 'correct', 'asked', 'maxCombo', 'durationMs', 'playedAt', 'scoring']) {
    if (typeof x[k] !== 'number' || !Number.isFinite(x[k] as number)) bad(k);
  }
  if (x.continues !== undefined && (typeof x.continues !== 'number' || !Number.isSafeInteger(x.continues))) bad('continues');
  if (x.profile !== undefined) {
    if (!isObj(x.profile)) bad('profile');
    else {
      str(x.profile.name, 'profile.name', 128);
      str(x.profile.title, 'profile.title', 64);
    }
  }
  return x as unknown as SubmitRunRequest;
}

export function validateBoardOnly(x: unknown): string {
  if (!isObj(x)) return bad('body');
  return str(x.board, 'board', 32);
}

export { LIMITS };
