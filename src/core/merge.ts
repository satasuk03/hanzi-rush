/**
 * Pure 3-way merge of save documents (docs/backend.md §5.3).
 * B = base (last snapshot both sides agreed on; callers pass freshSave() when nothing ever synced),
 * L = local, S = server. Counters add up (S + (L − B)), bests take the max, collections union,
 * scalars follow whichever side changed.
 */
import type { SaveDoc, WordStats, Cards, Stats, Daily, Look } from '../../shared/api';

type Rec = Record<string, any>;

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(v: T): T => structuredClone(v);
const keysOf = (...objs: (Rec | undefined)[]) => [...new Set(objs.flatMap((o) => Object.keys(o ?? {})))];
/** additive counter: the server value plus whatever this device added since the base */
const add = (s: unknown, l: unknown, b: unknown) => Math.max(0, num(s) + (num(l) - num(b)));

/** scalar rule: the local value wins only if this device changed it since the base (ties go to local) */
const lww = (b: unknown, l: unknown, s: unknown) => (!same(l, b) ? l : s);

/** keys not in `known` (new fields from a newer client) fall back to the scalar rule */
function scalars(out: Rec, B: Rec, L: Rec, S: Rec, known: readonly string[]) {
  for (const k of keysOf(L, S)) {
    if (known.includes(k)) continue;
    const v = lww(B[k], L[k], S[k]);
    if (v !== undefined) out[k] = clone(v);
  }
}

const ADDITIVE_STATS = ['games', 'questions', 'correct', 'perfect', 'pulls', 'coinsEarned', 'coinsSpent'] as const;
const KNOWN_STATS = [...ADDITIVE_STATS, 'bestCombo', 'maxCoins', 'byRarity'];
const KNOWN_PROGRESS = ['best', 'words', 'coins', 'xp', 'cards', 'pity', 'stats', 'profile', 'daily'];
const KNOWN_PROFILE = ['name', 'title', 'seen', 'look'];
const KNOWN_DAILY = ['last', 'streak', 'best', 'total'];

function mergeWords(B: WordStats = {}, L: WordStats = {}, S: WordStats = {}): WordStats {
  const out: WordStats = {};
  for (const w of keysOf(B, L, S)) {
    const [bs, bc] = B[w] ?? [0, 0];
    const [ls, lc] = L[w] ?? [0, 0];
    const sv = S[w];
    const seen = add(sv?.[0], ls, bs);
    const correct = Math.min(seen, add(sv?.[1], lc, bc));
    if (!sv && seen === 0 && correct === 0) continue;
    out[w] = [seen, correct];
  }
  return out;
}

function mergeCards(B: Cards = {}, L: Cards = {}, S: Cards = {}): Cards {
  const out: Cards = {};
  for (const k of keysOf(B, L, S)) {
    const b = B[k];
    const l = L[k];
    const s = S[k];
    const delta = num(l?.[0]) - num(b?.[0]);
    // a card the server never had and nobody on this side added since the base stays absent
    if (!s && delta <= 0) continue;
    const copies = s ? Math.max(1, num(s[0]) + delta) : delta;
    // rarity is deterministic per word, so either side's value is right
    const rarity = s?.[1] ?? l?.[1] ?? b?.[1] ?? 0;
    const firsts = [s?.[2], l?.[2]].map(num).filter((n) => n > 0);
    out[k] = [copies, rarity, firsts.length ? Math.min(...firsts) : 0];
  }
  return out;
}

/** per slot last-writer-wins (`badges` is one unit); a slot cleared on this device stays cleared */
function mergeLook(B: Rec = {}, L: Rec = {}, S: Rec = {}): Look {
  const out: Rec = {};
  for (const k of keysOf(B, L, S)) {
    const v = lww(B[k], L[k], S[k]);
    if (v !== undefined) out[k] = clone(v);
  }
  return out as Look;
}

function mergeDaily(B: Rec, L: Rec, S: Rec): Daily {
  const out: Rec = {};
  // `last` and `streak` travel as a pair: whichever claim is later
  let last: string = S.last ?? '';
  let streak = num(S.streak);
  if ((L.last ?? '') > last) {
    last = L.last;
    streak = num(L.streak);
  } else if ((L.last ?? '') === last) streak = Math.max(streak, num(L.streak));
  out.last = last;
  out.streak = streak;
  out.best = Math.max(num(S.best), num(L.best), streak);
  out.total = add(S.total, L.total, B.total);
  scalars(out, B, L, S, KNOWN_DAILY);
  return out as Daily;
}

export function merge(base: SaveDoc, local: SaveDoc, server: SaveDoc): SaveDoc {
  // identical copies (e.g. our own earlier push whose reply was lost): adding the delta again would double count
  if (same(local, server)) return clone(local);
  const B = base as unknown as Rec;
  const L = local as unknown as Rec;
  const S = server as unknown as Rec;
  const out: Rec = clone(S);
  out.v = 1;

  // ---- settings: every key last-writer-wins if changed locally
  const settings: Rec = {};
  for (const k of keysOf(L.settings, S.settings)) {
    const v = lww(B.settings?.[k], L.settings?.[k], S.settings?.[k]);
    if (v !== undefined) settings[k] = clone(v);
  }
  out.settings = settings;

  const bp: Rec = B.progress ?? {};
  const lp: Rec = L.progress ?? {};
  const sp: Rec = S.progress ?? {};
  const p: Rec = {};
  out.progress = p;

  p.coins = add(sp.coins, lp.coins, bp.coins);
  p.xp = add(sp.xp, lp.xp, bp.xp);
  p.pity = lww(bp.pity, lp.pity, sp.pity) ?? 0;

  // best scores: monotonic
  const best: Record<string, number> = {};
  for (const k of keysOf(lp.best, sp.best)) best[k] = Math.max(num(lp.best?.[k]), num(sp.best?.[k]));
  p.best = best;

  p.words = mergeWords(bp.words, lp.words, sp.words);
  p.cards = mergeCards(bp.cards, lp.cards, sp.cards);

  // stats
  const bs: Rec = bp.stats ?? {};
  const ls: Rec = lp.stats ?? {};
  const ss: Rec = sp.stats ?? {};
  const stats: Rec = {};
  for (const k of ADDITIVE_STATS) stats[k] = add(ss[k], ls[k], bs[k]);
  stats.bestCombo = Math.max(num(ss.bestCombo), num(ls.bestCombo));
  const n = Math.max(ls.byRarity?.length ?? 0, ss.byRarity?.length ?? 0);
  stats.byRarity = Array.from({ length: n }, (_, i) => add(ss.byRarity?.[i], ls.byRarity?.[i], bs.byRarity?.[i]));
  stats.maxCoins = Math.max(num(ss.maxCoins), num(ls.maxCoins), p.coins);
  scalars(stats, bs, ls, ss, KNOWN_STATS);
  p.stats = stats as Stats;

  // profile
  const bf: Rec = bp.profile ?? {};
  const lf: Rec = lp.profile ?? {};
  const sf: Rec = sp.profile ?? {};
  const profile: Rec = {
    name: lww(bf.name, lf.name, sf.name) ?? '',
    title: lww(bf.title, lf.title, sf.title) ?? 'novice',
    // union, server order first, then whatever this device added
    seen: [...new Set<string>([...(sf.seen ?? []), ...(lf.seen ?? [])])],
    look: mergeLook(bf.look, lf.look, sf.look),
  };
  scalars(profile, bf, lf, sf, KNOWN_PROFILE);
  p.profile = profile;

  p.daily = mergeDaily(bp.daily ?? {}, lp.daily ?? {}, sp.daily ?? {});

  // fields from a newer client that this version doesn't know
  scalars(p, bp, lp, sp, KNOWN_PROGRESS);
  scalars(out, B, L, S, ['v', 'settings', 'progress']);
  return out as SaveDoc;
}
