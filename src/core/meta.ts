/**
 * Meta progression shared by every game: coins (spent in the vault), XP → player level,
 * and titles (称号) unlocked by level or achievements and worn on the profile card.
 */
import { store } from './store';
import { LEVELS } from './data';
import { wallet } from './wallet';
import { itemById } from '../../shared/cosmetics';
import { TITLE_DEFS, TITLE_FAMILIES, type TitleReq, type TitleStat, type TitleFamily } from '../../shared/titles';

// ------------------------------------------------------------------ level curve
export interface LevelInfo {
  level: number;
  /** XP earned inside the current level */
  into: number;
  /** XP needed to clear the current level */
  need: number;
}

export const xpToNext = (L: number) => Math.round(60 * L ** 1.35 + 40);

export function levelOf(xp: number): LevelInfo {
  let level = 1;
  let rest = xp;
  while (rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, need: xpToNext(level) };
}

export const playerLevel = () => levelOf(store.progress.xp);

// ------------------------------------------------------------------ titles
export interface Title {
  id: string;
  zh: string;
  en: string;
  th: string;
  /** requirement text */
  req: { en: string; th: string };
  /** 0..1 progress toward unlocking */
  progress: () => number;
  /** visual tier 0..4, reuses rarity colours */
  tier: number;
  family: TitleFamily;
}

const owned = () => Object.keys(store.progress.cards).length;
const ownedIn = (lv: number) => {
  const pre = `${lv}:`;
  let n = 0;
  for (const k in store.progress.cards) if (k.startsWith(pre)) n++;
  return n;
};
const totalWords = () => LEVELS.reduce((s, L) => s + L.count, 0);
/** words seen 5+ times and answered right 80%+ of the time */
const mastered = () => {
  let n = 0;
  for (const k in store.progress.words) {
    const [seen, ok] = store.progress.words[k];
    if (seen >= 5 && ok / seen >= 0.8) n++;
  }
  return n;
};
/** distinct cosmetics in the cached inventory (0 while it is unknown, e.g. offline on a fresh install) */
const cosmetics = () => {
  let n = 0;
  const inv = wallet.inventory;
  for (const id in inv) if (inv[id] > 0 && itemById(id)) n++;
  return n;
};
const STAT: Record<TitleStat, () => number> = {
  perfect: () => store.progress.stats.perfect,
  bestCombo: () => store.progress.stats.bestCombo,
  correct: () => store.progress.stats.correct,
  wrong: () => store.progress.stats.questions - store.progress.stats.correct,
  games: () => store.progress.stats.games,
  pulls: () => store.progress.stats.pulls,
  maxCoins: () => store.progress.stats.maxCoins,
  legendary: () => store.progress.stats.byRarity[3] + store.progress.stats.byRarity[4],
  mythic: () => store.progress.stats.byRarity[4],
};

const fmt = (n: number) => n.toLocaleString('en-US');
const STAT_REQ: Record<TitleStat, (n: number) => { en: string; th: string }> = {
  perfect: (n) => ({ en: n === 1 ? 'Finish a practice run with no mistakes' : `Finish ${n} practice runs with no mistakes`, th: n === 1 ? 'จบโหมดฝึกซ้อมโดยไม่ผิดเลย' : `จบโหมดฝึกซ้อมโดยไม่ผิดเลย ${n} ครั้ง` }),
  bestCombo: (n) => ({ en: `Hit a ×${n} combo`, th: `ทำคอมโบ ×${n}` }),
  correct: (n) => ({ en: `Answer ${fmt(n)} questions correctly`, th: `ตอบถูกครบ ${fmt(n)} ข้อ` }),
  wrong: (n) => ({ en: `Get ${fmt(n)} answers wrong and keep going`, th: `ตอบผิดครบ ${fmt(n)} ข้อ แต่ยังสู้ต่อ` }),
  games: (n) => ({ en: `Play ${fmt(n)} games`, th: `เล่นครบ ${fmt(n)} เกม` }),
  pulls: (n) => ({ en: `Open ${fmt(n)} cards`, th: `เปิดการ์ดครบ ${fmt(n)} ใบ` }),
  maxCoins: (n) => ({ en: `Hold ${fmt(n)} coins at once`, th: `มีเหรียญพร้อมกัน ${fmt(n)}` }),
  legendary: (n) => ({ en: `Pull ${n} LEGENDARY or better`, th: `เปิดได้ LEGENDARY ขึ้นไป ${n} ใบ` }),
  mythic: (n) => ({ en: n === 1 ? 'Pull a MYTHIC card' : `Pull ${n} MYTHIC cards`, th: n === 1 ? 'เปิดได้การ์ด MYTHIC' : `เปิดได้การ์ด MYTHIC ${n} ใบ` }),
};

function reqText(r: TitleReq): { en: string; th: string } {
  switch (r.k) {
    case 'none':
      return { en: 'Everyone starts here', th: 'ทุกคนเริ่มที่นี่' };
    case 'level':
      return { en: `Reach level ${r.n}`, th: `ถึงเลเวล ${r.n}` };
    case 'owned':
      return { en: `Collect ${fmt(r.n)} words`, th: `สะสมครบ ${fmt(r.n)} คำ` };
    case 'hsk':
      return { en: `Collect every HSK ${r.n} word`, th: `สะสมคำ HSK ${r.n} ครบทุกคำ` };
    case 'all':
      return { en: 'Collect every word in the game', th: 'สะสมคำศัพท์ครบทุกคำในเกม' };
    case 'streak':
      return { en: `Log in ${r.n} days in a row`, th: `เข้าเล่นติดต่อกัน ${r.n} วัน` };
    case 'mastered':
      return { en: `Master ${fmt(r.n)} words (seen 5+ times, 80%+ right)`, th: `จำได้แม่น ${fmt(r.n)} คำ (เจอ 5 ครั้งขึ้นไป ตอบถูก 80%+)` };
    case 'cosmetics':
      return { en: `Own ${fmt(r.n)} cosmetics`, th: `สะสมของตกแต่งครบ ${fmt(r.n)} ชิ้น` };
    case 'stat':
      return STAT_REQ[r.key](r.n);
  }
}

/** 0..1 progress toward a requirement */
function progressOf(r: TitleReq): number {
  const frac = (v: number, goal: number) => Math.min(1, v / goal);
  switch (r.k) {
    case 'none':
      return 1;
    case 'level':
      return frac(playerLevel().level, r.n);
    case 'owned':
      return frac(owned(), r.n);
    case 'hsk':
      return frac(ownedIn(r.n), LEVELS[r.n - 1].count);
    case 'all':
      return frac(owned(), totalWords());
    case 'streak':
      return frac(store.progress.daily.best, r.n);
    case 'mastered':
      return frac(mastered(), r.n);
    case 'cosmetics':
      return frac(cosmetics(), r.n);
    case 'stat':
      return frac(STAT[r.key](), r.n);
  }
}

export { TITLE_FAMILIES };
export const TITLES: Title[] = TITLE_DEFS.map((d) => ({ id: d.id, zh: d.zh, en: d.en, th: d.th, tier: d.tier, family: d.family, req: reqText(d.req), progress: () => progressOf(d.req) }));

export const titleById = (id: string) => TITLES.find((t) => t.id === id) ?? TITLES[0];
export const isUnlocked = (t: Title) => t.progress() >= 1;

/** Titles unlocked since the player was last told. Marks them as seen. */
export function newTitles(): Title[] {
  const seen = new Set(store.progress.profile.seen);
  const fresh = TITLES.filter((t) => !seen.has(t.id) && isUnlocked(t));
  if (fresh.length) {
    store.progress.profile.seen.push(...fresh.map((t) => t.id));
    store.save();
  }
  return fresh;
}

// ------------------------------------------------------------------ wallet & xp
export function addCoins(n: number) {
  const p = store.progress;
  p.coins += n;
  p.stats.coinsEarned += n;
  p.stats.maxCoins = Math.max(p.stats.maxCoins, p.coins);
}

export function spendCoins(n: number) {
  const p = store.progress;
  if (p.coins < n) return false;
  p.coins -= n;
  p.stats.coinsSpent += n;
  return true;
}

export interface XpGain {
  xp: number;
  before: LevelInfo;
  after: LevelInfo;
}

export function addXp(n: number): XpGain {
  const before = playerLevel();
  store.progress.xp += n;
  return { xp: n, before, after: playerLevel() };
}

// ------------------------------------------------------------------ run rewards
export interface Reward extends XpGain {
  coins: number;
  titles: Title[];
}

/** Pay out a finished game run: coins + XP, lifetime stats, freshly unlocked titles. */
export function awardRun(r: { score: number; correct: number; asked: number; maxCombo: number; rush: boolean }): Reward {
  const s = store.progress.stats;
  s.games++;
  s.questions += r.asked;
  s.correct += r.correct;
  s.bestCombo = Math.max(s.bestCombo, r.maxCombo);
  const perfect = !r.rush && r.asked > 0 && r.correct === r.asked;
  if (perfect) s.perfect++;
  const coins = Math.round(r.correct * 5 + r.score / 40);
  addCoins(coins);
  const gain = addXp(r.correct * 12 + r.asked * 3 + r.maxCombo * 3 + (perfect ? 50 : 0));
  store.save();
  return { ...gain, coins, titles: newTitles() };
}

// ------------------------------------------------------------------ daily login & streak
/** coins for day 1..7 of the streak cycle; the streak keeps counting past 7, the reward table loops */
export const DAILY_REWARDS = [50, 75, 100, 125, 150, 200, 500];

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayNum = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

export interface DailyStatus {
  claimable: boolean;
  /** streak the player holds right now (0 once it has lapsed) */
  streak: number;
  /** streak after claiming today */
  next: number;
  /** 0..6 slot of the reward that claiming today pays */
  slot: number;
}

export function dailyStatus(): DailyStatus {
  const d = store.progress.daily;
  const gap = d.last ? dayNum(dayKey()) - dayNum(d.last) : Infinity;
  // gap < 0 means the clock went backwards: never pay twice, never break the streak
  const claimable = gap >= 1;
  const streak = gap <= 1 ? d.streak : 0;
  const next = gap === 1 ? d.streak + 1 : claimable ? 1 : d.streak;
  return { claimable, streak, next, slot: (next - 1) % DAILY_REWARDS.length };
}

export interface DailyClaim {
  coins: number;
  streak: number;
  slot: number;
  titles: Title[];
}

export function claimDaily(): DailyClaim | null {
  const s = dailyStatus();
  if (!s.claimable) return null;
  const d = store.progress.daily;
  d.last = dayKey();
  d.streak = s.next;
  d.best = Math.max(d.best, d.streak);
  d.total++;
  const coins = DAILY_REWARDS[s.slot];
  addCoins(coins);
  store.save();
  return { coins, streak: d.streak, slot: s.slot, titles: newTitles() };
}
