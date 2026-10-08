import type { SaveDoc } from '../shared/api';
import { completedSets, itemById } from '../shared/cosmetics';
import { levelOf } from '../shared/level';
import type { TitleFacts, TitleStat } from '../shared/titles';

/**
 * `TitleFacts` over a stored cloud save plus the server inventory (item id -> copies). Mirrors the client
 * definitions in src/core/meta.ts exactly; the shared evaluator (shared/titles.ts) does the rest.
 */
export function factsFromSave(doc: SaveDoc, inventory: ReadonlyMap<string, number>): TitleFacts {
  const p = doc.progress;
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
  const keys = Object.keys(p.cards ?? {});
  const owns = (id: string) => (inventory.get(id) ?? 0) > 0;
  const s = p.stats;
  const STAT: Record<TitleStat, () => number> = {
    perfect: () => num(s.perfect),
    bestCombo: () => num(s.bestCombo),
    correct: () => num(s.correct),
    wrong: () => num(s.questions) - num(s.correct),
    games: () => num(s.games),
    pulls: () => num(s.pulls),
    maxCoins: () => num(s.maxCoins),
    legendary: () => num(s.byRarity?.[3]) + num(s.byRarity?.[4]),
    mythic: () => num(s.byRarity?.[4]),
  };
  return {
    level: () => levelOf(num(p.xp)).level,
    owned: () => keys.length,
    ownedIn: (lv) => keys.filter((k) => k.startsWith(`${lv}:`)).length,
    mastered: () => {
      let n = 0;
      for (const k in p.words ?? {}) {
        const [seen, ok] = p.words[k];
        if (seen >= 5 && ok / seen >= 0.8) n++;
      }
      return n;
    },
    streakBest: () => num(p.daily?.best),
    cosmetics: () => {
      let n = 0;
      for (const [id, copies] of inventory) if (copies > 0 && itemById(id)) n++;
      return n;
    },
    sets: () => completedSets(owns).length,
    stat: (k) => STAT[k](),
  };
}
