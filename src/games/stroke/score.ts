// Stroke Master run accounting: pure, no DOM. The score is ONLY the sum of strokeWordPoints over the
// destroyed words, so the server can recompute it from the `strokeWords` tuples (shared/api.ts checkRun).
import { strokeWordPoints, type StrokeWords } from '../../../shared/api';

export { strokeWordPoints };

export class RunAccount {
  score = 0;
  combo = 0;
  maxCombo = 0;
  destroyed = 0;
  landed = 0;
  /** one [strokes, combo after increment, perfect] per destroyed word, in destroy order */
  words: StrokeWords = [];

  /** a word was written completely */
  destroy(strokes: number, perfect: boolean) {
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.destroyed++;
    const p = perfect ? 1 : 0;
    const pts = strokeWordPoints(strokes, this.combo, p);
    this.score += pts;
    this.words.push([strokes, this.combo, p]);
    return pts;
  }
  /** a word reached the ground */
  land() {
    this.landed++;
    this.combo = 0;
  }
  /** a wrong stroke graded against a locked target */
  wrong() {
    this.combo = 0;
  }
  get asked() {
    return this.destroyed + this.landed;
  }
}
