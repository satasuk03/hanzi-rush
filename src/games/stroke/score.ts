// Stroke Master scoring: pure, no DOM. Kept in one place so a server-verifiable
// formula can replace it later (the ranked submission needs per-word facts).
export const COMBO_CAP = 20;

/** Per-word facts recorded during the run. */
export interface WordFact {
  /** word hanzi (Word.h) */
  h: string;
  /** total strokes in the word */
  strokes: number;
  /** no wrong strokes while writing it */
  perfect: boolean;
  /** milliseconds from spawn to resolution (game time, pauses excluded) */
  ms: number;
  /** true = reached the ground, false = written */
  landed: boolean;
  /** combo right after completion (0 when landed) */
  combo: number;
  /** points the word itself paid (0 when landed) */
  points: number;
}

/** Points for one correct stroke, from the combo before the stroke. */
export function strokePoints(combo: number): number {
  return Math.round(10 * (1 + Math.min(combo, COMBO_CAP) * 0.1));
}

/** Points for finishing a word; `combo` is the combo including this word. */
export function wordPoints(f: { strokes: number; perfect: boolean; combo: number }): number {
  return Math.round(f.strokes * 60 * (1 + Math.min(f.combo, COMBO_CAP) * 0.15) * (f.perfect ? 1.5 : 1));
}
