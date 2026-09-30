import type { Lang } from './i18n';

export interface Settings {
  lang: Lang;
  sound: boolean;
  pinyin: boolean;
  voice: boolean;
}

/** Per-word learning stats: [seen, correct]. Kept compact for future SRS games. */
export type WordStats = Record<string, [number, number]>;

/** Collected gacha cards: `${level}:${hanzi}` → [copies, rarity index, first-pulled epoch seconds]. */
export type Cards = Record<string, [number, number, number]>;

export interface Stats {
  games: number;
  questions: number;
  correct: number;
  bestCombo: number;
  perfect: number;
  pulls: number;
  coinsEarned: number;
  coinsSpent: number;
  maxCoins: number;
  /** pulls per rarity index */
  byRarity: number[];
}

export interface Profile {
  name: string;
  /** equipped title id */
  title: string;
  /** titles the player has already been told about */
  seen: string[];
}

export interface Progress {
  /** best score per `${gameId}:${level}:${mode}` */
  best: Record<string, number>;
  words: WordStats;
  coins: number;
  xp: number;
  cards: Cards;
  /** pulls since the last LEGENDARY+ (hard pity) */
  pity: number;
  stats: Stats;
  profile: Profile;
}

const KEY = 'hanzi-rush:v1';
/** welcome gift so the vault can be tried before the first run */
export const STARTING_COINS = 500;

const defaults = (): { settings: Settings; progress: Progress } => ({
  settings: { lang: 'th', sound: true, pinyin: true, voice: true },
  progress: {
    best: {},
    words: {},
    coins: STARTING_COINS,
    xp: 0,
    cards: {},
    pity: 0,
    stats: { games: 0, questions: 0, correct: 0, bestCombo: 0, perfect: 0, pulls: 0, coinsEarned: 0, coinsSpent: 0, maxCoins: STARTING_COINS, byRarity: [0, 0, 0, 0, 0] },
    profile: { name: '', title: 'novice', seen: ['novice'] },
  },
});

function load() {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const parsed = JSON.parse(raw);
    const p = parsed.progress ?? {};
    return {
      settings: { ...d.settings, ...parsed.settings },
      progress: {
        ...d.progress,
        ...p,
        stats: { ...d.progress.stats, ...p.stats },
        profile: { ...d.progress.profile, ...p.profile },
      },
    };
  } catch {
    return d;
  }
}

const state = load();

export const store = {
  settings: state.settings,
  progress: state.progress,
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ settings: state.settings, progress: state.progress }));
    } catch {
      /* storage unavailable (private mode) — play on without persistence */
    }
  },
  recordWord(hanzi: string, ok: boolean) {
    const s = (state.progress.words[hanzi] ??= [0, 0]);
    s[0]++;
    if (ok) s[1]++;
  },
  getBest(key: string) {
    return state.progress.best[key] ?? 0;
  },
  /** returns true if it's a new record */
  submitBest(key: string, score: number) {
    if (score > (state.progress.best[key] ?? 0)) {
      state.progress.best[key] = score;
      store.save();
      return true;
    }
    return false;
  },
};
