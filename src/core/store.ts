import type { Settings, WordStats, Cards, Stats, Profile, Daily, Progress, SaveDoc } from '../../shared/api';

// the save-document shapes live in the shared API contract; re-exported so existing importers keep working
export type { Settings, WordStats, Cards, Stats, Profile, Daily, Progress, SaveDoc };

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
    daily: { last: '', streak: 0, best: 0, total: 0 },
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
        daily: { ...d.progress.daily, ...p.daily },
      },
    };
  } catch {
    return d;
  }
}

const state = load();

/** a pristine save: the merge base when nothing has ever synced */
export const freshSave = (): SaveDoc => ({ v: 1, ...defaults() });

const saveListeners = new Set<() => void>();

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** overwrite `target` with `src` without replacing nested containers, so held references stay valid */
function assignInPlace(target: any, src: any) {
  if (Array.isArray(target) && Array.isArray(src)) {
    target.length = 0;
    for (const v of src) target.push(structuredClone(v));
    return;
  }
  for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  for (const k of Object.keys(src)) {
    if (isObj(target[k]) && isObj(src[k])) assignInPlace(target[k], src[k]);
    else if (Array.isArray(target[k]) && Array.isArray(src[k])) assignInPlace(target[k], src[k]);
    else target[k] = structuredClone(src[k]);
  }
}

export const store = {
  settings: state.settings,
  progress: state.progress,
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ settings: state.settings, progress: state.progress }));
    } catch {
      /* storage unavailable (private mode) — play on without persistence */
    }
    saveListeners.forEach((f) => f());
  },
  /** called after every save(); returns an unsubscribe */
  onSave(cb: () => void) {
    saveListeners.add(cb);
    return () => saveListeners.delete(cb);
  },
  /** deep copy of everything that is synced to the cloud */
  snapshot(): SaveDoc {
    return structuredClone({ v: 1 as const, settings: state.settings, progress: state.progress });
  },
  /** replace the whole save (cloud merge / restore). Mutates in place so `store.progress` keeps its identity. */
  replaceAll(doc: SaveDoc) {
    const d = defaults();
    const p = doc.progress;
    assignInPlace(state.settings, { ...d.settings, ...doc.settings });
    assignInPlace(state.progress, {
      ...d.progress,
      ...p,
      stats: { ...d.progress.stats, ...p.stats },
      profile: { ...d.progress.profile, ...p.profile },
      daily: { ...d.progress.daily, ...p.daily },
    });
    store.save();
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
