// Stroke data loader (public/data/strokes/hsk{n}.json, built by scripts/build-strokes.mjs).
// Source data is y-up in a 1024 box with the baseline at 900. Medians are flipped once to
// y-down ([x, 900 - y]) for the matcher; paths stay y-up and are drawn with a negative y scale.
import type { Pt } from '../games/stroke/matcher';

export interface RawGlyph {
  /** SVG path per stroke (y-up) */
  s: string[];
  /** median polyline per stroke (y-up) */
  m: number[][][];
}

export interface Glyph {
  ch: string;
  /** stroke count */
  n: number;
  /** one Path2D per stroke (y-up, draw with a negative y scale); built lazily */
  paths: Path2D[];
  /** medians, already y-flipped: [x, 900 - y] */
  med: Pt[][];
}

export type StrokeLevel = Record<string, RawGlyph>;

const cache = new Map<number, Promise<StrokeLevel>>();

export function loadStrokes(n: number): Promise<StrokeLevel> {
  let p = cache.get(n);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/strokes/hsk${n}.json`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<StrokeLevel>;
    });
    p.catch(() => cache.delete(n));
    cache.set(n, p);
  }
  return p;
}

/** Pure conversion of the medians (no DOM): y-up -> y-down. */
export function flipMedians(m: number[][][]): Pt[][] {
  return m.map((st) => st.map(([x, y]): Pt => [x, 900 - y]));
}

/** Han characters of a word that are missing from the level's stroke data (empty = playable). */
export function missingChars(word: string, data: StrokeLevel): string[] {
  return (word.match(/\p{Script=Han}/gu) ?? []).filter((c) => !data[c]);
}

/**
 * Build a Glyph. `paths` is a lazy getter, so the module and `toGlyph` work without a DOM
 * (node tests only touch `med` and `n`); Path2D objects are created on first access.
 */
export function toGlyph(ch: string, raw: RawGlyph): Glyph {
  let paths: Path2D[] | null = null;
  return {
    ch,
    n: raw.s.length,
    med: flipMedians(raw.m),
    get paths() {
      return (paths ??= raw.s.map((d) => new Path2D(d)));
    },
  };
}

const glyphs = new Map<string, Glyph>();

/** Cached Glyph for a character of a loaded level, or null if it has no stroke data. */
export function glyphOf(ch: string, data: StrokeLevel): Glyph | null {
  let g = glyphs.get(ch);
  if (!g) {
    const raw = data[ch];
    if (!raw) return null;
    g = toGlyph(ch, raw);
    glyphs.set(ch, g);
  }
  return g;
}
