import type { Lang } from './i18n';

export interface Settings {
  lang: Lang;
  sound: boolean;
  pinyin: boolean;
  voice: boolean;
}

/** Per-word learning stats: [seen, correct]. Kept compact for future SRS games. */
export type WordStats = Record<string, [number, number]>;

export interface Progress {
  /** best score per `${gameId}:${level}:${mode}` */
  best: Record<string, number>;
  words: WordStats;
}

const KEY = 'hanzi-rush:v1';

const defaults = (): { settings: Settings; progress: Progress } => ({
  settings: { lang: 'th', sound: true, pinyin: true, voice: true },
  progress: { best: {}, words: {} },
});

function load() {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const parsed = JSON.parse(raw);
    return {
      settings: { ...d.settings, ...parsed.settings },
      progress: { ...d.progress, ...parsed.progress },
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
