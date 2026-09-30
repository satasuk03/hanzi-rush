/**
 * Pull logic. Rarity is rolled first (with a ×10 EPIC+ guarantee and a hard pity for
 * LEGENDARY+), then a word of that rarity is drawn, favouring words not collected yet.
 * Everything is committed to the store before the ceremony plays, so a reload never loses a pull.
 */
import type { Word } from '../../core/data';
import { store } from '../../core/store';
import { RARITIES, EPIC, LEGENDARY, rarities, cardKey } from '../../core/rarity';
import { addCoins, newTitles, spendCoins, type Title } from '../../core/meta';

export const PRICE = [50, 60, 80, 100, 120, 150];
export const HARD_PITY = 50;
export const MAX_QTY = 10;

export const unitPrice = (level: number) => PRICE[level - 1];
/** ×10 costs 9 */
export const priceFor = (level: number, qty: number) => unitPrice(level) * (qty >= MAX_QTY ? MAX_QTY - 1 : qty);

export interface Pull {
  word: Word;
  /** 1-based collection number inside the level */
  no: number;
  rarity: number;
  isNew: boolean;
  copies: number;
  refund: number;
}

export interface PullBatch {
  level: number;
  pulls: Pull[];
  best: number;
  titles: Title[];
  cost: number;
}

function rollRarity(min: number) {
  const pool = RARITIES.filter((r) => r.i >= min);
  const total = pool.reduce((s, r) => s + r.rate, 0);
  let x = Math.random() * total;
  for (const r of pool) {
    x -= r.rate;
    if (x <= 0) return r.i;
  }
  return pool[pool.length - 1].i;
}

export function ownedCount(level: number) {
  const pre = `${level}:`;
  let n = 0;
  for (const k in store.progress.cards) if (k.startsWith(pre)) n++;
  return n;
}

/** Spend coins and roll `qty` cards. Returns null if the player can't afford it. */
export function pull(level: number, words: Word[], qty: number): PullBatch | null {
  const cost = priceFor(level, qty);
  if (!spendCoins(cost)) return null;
  const p = store.progress;
  const tiers = rarities(level, words);
  const byTier: number[][] = RARITIES.map(() => []);
  tiers.forEach((t, i) => byTier[t].push(i));
  const taken = new Set<number>();
  const pulls: Pull[] = [];

  for (let n = 0; n < qty; n++) {
    let min = 0;
    if (p.pity >= HARD_PITY - 1) min = LEGENDARY;
    else if (qty >= MAX_QTY && n === qty - 1 && !pulls.some((x) => x.rarity >= EPIC)) min = EPIC;
    const tier = rollRarity(min);

    // weighted pick: uncollected words ×3, no repeats inside a batch when avoidable
    const cands = byTier[tier].filter((i) => !taken.has(i));
    const list = cands.length ? cands : byTier[tier];
    const weights = list.map((i) => (p.cards[cardKey(level, words[i].h)] ? 1 : 3));
    let x = Math.random() * weights.reduce((a, b) => a + b, 0);
    let idx = list[list.length - 1];
    for (let j = 0; j < list.length; j++) {
      x -= weights[j];
      if (x <= 0) {
        idx = list[j];
        break;
      }
    }
    taken.add(idx);

    const w = words[idx];
    const key = cardKey(level, w.h);
    const had = p.cards[key];
    const isNew = !had;
    const copies = (had?.[0] ?? 0) + 1;
    p.cards[key] = [copies, tier, had?.[2] ?? Math.floor(Date.now() / 1000)];
    const refund = isNew ? 0 : Math.round(unitPrice(level) * RARITIES[tier].refund);
    if (refund) addCoins(refund);
    p.stats.pulls++;
    p.stats.byRarity[tier]++;
    p.pity = tier >= LEGENDARY ? 0 : p.pity + 1;
    pulls.push({ word: w, no: idx + 1, rarity: tier, isNew, copies, refund });
  }

  store.save();
  return { level, pulls, best: Math.max(...pulls.map((x) => x.rarity)), titles: newTitles(), cost };
}
