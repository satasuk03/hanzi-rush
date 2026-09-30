/**
 * Meta progression shared by every game: coins (spent in the vault), XP → player level,
 * and titles (称号) unlocked by level or achievements and worn on the profile card.
 */
import { store } from './store';
import { LEVELS } from './data';

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
}

const owned = () => Object.keys(store.progress.cards).length;
const ownedIn = (lv: number) => {
  const pre = `${lv}:`;
  let n = 0;
  for (const k in store.progress.cards) if (k.startsWith(pre)) n++;
  return n;
};
const lvReq = (L: number) => () => Math.min(1, playerLevel().level / L);
const count = (v: () => number, goal: number) => () => Math.min(1, v() / goal);
const st = () => store.progress.stats;

export const TITLES: Title[] = [
  { id: 'novice', zh: '初学者', en: 'Novice', th: 'มือใหม่หัดจีน', req: { en: 'Everyone starts here', th: 'ทุกคนเริ่มที่นี่' }, progress: () => 1, tier: 0 },
  { id: 'inkling', zh: '墨童', en: 'Ink Apprentice', th: 'ศิษย์น้ำหมึก', req: { en: 'Reach level 3', th: 'ถึงเลเวล 3' }, progress: lvReq(3), tier: 0 },
  { id: 'collector', zh: '藏家', en: 'Collector', th: 'นักสะสม', req: { en: 'Collect 50 words', th: 'สะสมครบ 50 คำ' }, progress: count(owned, 50), tier: 1 },
  { id: 'scholar', zh: '书生', en: 'Scholar', th: 'บัณฑิตหนุ่ม', req: { en: 'Reach level 5', th: 'ถึงเลเวล 5' }, progress: lvReq(5), tier: 1 },
  { id: 'sharp', zh: '百发百中', en: 'Sharpshooter', th: 'แม่นเหมือนจับวาง', req: { en: 'Finish a practice run with no mistakes', th: 'จบโหมดฝึกซ้อมโดยไม่ผิดเลย' }, progress: count(() => st().perfect, 1), tier: 1 },
  { id: 'hsk1', zh: '入门圆满', en: 'HSK 1 Complete', th: 'พิชิต HSK 1', req: { en: 'Collect every HSK 1 word', th: 'สะสมคำ HSK 1 ครบทุกคำ' }, progress: count(() => ownedIn(1), LEVELS[0].count), tier: 2 },
  { id: 'combo', zh: '连击王', en: 'Combo King', th: 'ราชาคอมโบ', req: { en: 'Hit a ×30 combo', th: 'ทำคอมโบ ×30' }, progress: count(() => st().bestCombo, 30), tier: 2 },
  { id: 'brush', zh: '笔仙', en: 'Brush Sage', th: 'เซียนพู่กัน', req: { en: 'Reach level 10', th: 'ถึงเลเวล 10' }, progress: lvReq(10), tier: 2 },
  { id: 'golden', zh: '金手指', en: 'Golden Touch', th: 'มือทอง', req: { en: 'Pull 5 LEGENDARY or better', th: 'เปิดได้ LEGENDARY ขึ้นไป 5 ใบ' }, progress: count(() => st().byRarity[3] + st().byRarity[4], 5), tier: 3 },
  { id: 'librarian', zh: '藏经阁主', en: 'Keeper of Scrolls', th: 'ผู้พิทักษ์คัมภีร์', req: { en: 'Collect 500 words', th: 'สะสมครบ 500 คำ' }, progress: count(owned, 500), tier: 3 },
  { id: 'whale', zh: '豪客', en: 'High Roller', th: 'สายเปย์', req: { en: 'Open 200 cards', th: 'เปิดการ์ดครบ 200 ใบ' }, progress: count(() => st().pulls, 200), tier: 3 },
  { id: 'wealth', zh: '财神爷', en: 'God of Wealth', th: 'เทพเจ้าแห่งโชคลาภ', req: { en: 'Hold 5,000 coins at once', th: 'มีเหรียญพร้อมกัน 5,000' }, progress: count(() => st().maxCoins, 5000), tier: 3 },
  { id: 'streak7', zh: '恒心', en: 'Steadfast', th: 'ใจเด็ด 7 วัน', req: { en: 'Log in 7 days in a row', th: 'เข้าเล่นติดต่อกัน 7 วัน' }, progress: count(() => store.progress.daily.best, 7), tier: 2 },
  { id: 'streak30', zh: '持之以恒', en: 'Unwavering', th: 'ไฟไม่มอด', req: { en: 'Log in 30 days in a row', th: 'เข้าเล่นติดต่อกัน 30 วัน' }, progress: count(() => store.progress.daily.best, 30), tier: 3 },
  { id: 'master', zh: '汉字大师', en: 'Hanzi Master', th: 'ปรมาจารย์อักษร', req: { en: 'Reach level 20', th: 'ถึงเลเวล 20' }, progress: lvReq(20), tier: 4 },
  { id: 'chosen', zh: '天选之人', en: 'The Chosen One', th: 'ผู้ถูกเลือก', req: { en: 'Pull a MYTHIC card', th: 'เปิดได้การ์ด MYTHIC' }, progress: count(() => st().byRarity[4], 1), tier: 4 },
];

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
