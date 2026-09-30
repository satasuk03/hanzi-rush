/**
 * Word rarity. Every word has a fixed rarity (so the collection means something), assigned
 * deterministically per level: a stable hash ranks the words, idioms (4+ chars) get a head start.
 */
import type { Word } from './data';

export interface Rarity {
  i: number;
  name: string;
  zh: string;
  /** single glyph carved into the card's seal */
  seal: string;
  color: string;
  deep: string;
  glow: string;
  /** pull probability */
  rate: number;
  /** share of each level's words */
  share: number;
  /** min words per level in this tier */
  min: number;
  /** duplicate refund, × pull price */
  refund: number;
}

export const RARITIES: Rarity[] = [
  { i: 0, name: 'COMMON', zh: '普通', seal: '凡', color: '#b4adc0', deep: '#5d5668', glow: '#f1ecf7', rate: 0.55, share: 0.5, min: 0, refund: 0.1 },
  { i: 1, name: 'RARE', zh: '稀有', seal: '稀', color: '#3d8bff', deep: '#1a4fb3', glow: '#a9cdff', rate: 0.28, share: 0.28, min: 4, refund: 0.2 },
  { i: 2, name: 'EPIC', zh: '史诗', seal: '珍', color: '#b25cff', deep: '#6a1fb0', glow: '#e0bdff', rate: 0.12, share: 0.14, min: 3, refund: 0.5 },
  { i: 3, name: 'LEGENDARY', zh: '传说', seal: '传', color: '#ffb321', deep: '#b36a00', glow: '#ffe6a3', rate: 0.04, share: 0.06, min: 2, refund: 1 },
  { i: 4, name: 'MYTHIC', zh: '神话', seal: '神', color: '#ff3d63', deep: '#a3102f', glow: '#ffc0cd', rate: 0.01, share: 0.02, min: 1, refund: 2 },
];

export const LEGENDARY = 3;
export const EPIC = 2;

export function hash(s: string) {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 0x01000193);
  }
  return x >>> 0;
}

/** Small seeded PRNG so procedural card art is identical on every redraw. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<number, Int8Array>();

/** rarity index for every word of a level, parallel to the word list */
export function rarities(level: number, words: Word[]): Int8Array {
  let r = cache.get(level);
  if (r && r.length === words.length) return r;
  const n = words.length;
  const score = words.map((w, i) => {
    const len = [...w.h].length;
    return { i, s: hash(`${level}:${w.h}`) / 4294967296 + (len >= 4 ? 0.55 : len === 3 ? 0.12 : 0) };
  });
  score.sort((a, b) => b.s - a.s);
  r = new Int8Array(n);
  let k = 0;
  for (let t = RARITIES.length - 1; t >= 1; t--) {
    const R = RARITIES[t];
    const count = Math.max(R.min, Math.round(n * R.share));
    for (let j = 0; j < count && k < n; j++) r[score[k++].i] = t;
  }
  cache.set(level, r);
  return r;
}

export const cardKey = (level: number, h: string) => `${level}:${h}`;
