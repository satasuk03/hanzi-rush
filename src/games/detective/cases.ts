/**
 * Word Detective case logic (no DOM). A round opens a few unseen words as "cases"; each case walks
 * guess (猜, meaning from context) → listen (听, sound to hanzi) → recall (认, meaning to hanzi).
 * Cases interleave: a step that was just played comes back a few turns later, so the player meets
 * every word several times, spaced, inside one round.
 */
import type { Word } from '../../core/data';
import type { WordStats } from '../../core/store';
import { shuffle } from '../../core/util';

export const STEPS = ['guess', 'listen', 'recall'] as const;
export type Step = (typeof STEPS)[number];

export interface Case {
  word: Word;
  step: Step;
  /** docket turn at which this case may be asked again */
  due: number;
  misses: number;
  /** the opening guess was right (null until it is played) */
  guessed: boolean | null;
  clued: boolean;
  closed: boolean;
}

export const CASES_PER_ROUND = 5;
/** turns to wait before a case comes back: after its guess, after its listen, after a miss */
const GAP = { guess: 2, listen: 3, miss: 2 } as const;

/** a word is a usable case when its own example sentence contains it and its meaning is short enough for a button */
export const usable = (w: Word) => w.ex.zh.includes(w.h) && w.th.length <= 16 && w.en.length <= 28 && !/particle/i.test(w.en);

/** unseen words first (never answered in any game), then the least seen */
export function pickCases(words: Word[], stats: WordStats, n = CASES_PER_ROUND): Word[] {
  const seen = (w: Word) => stats[w.h]?.[0] ?? 0;
  return shuffle(words.filter(usable))
    .sort((a, b) => seen(a) - seen(b))
    .slice(0, n);
}

export class Docket {
  readonly cases: Case[];
  private turn = 0;
  private opened = 0;

  constructor(words: Word[]) {
    this.cases = words.map((word) => ({ word, step: 'guess', due: 0, misses: 0, guessed: null, clued: false, closed: false }));
  }

  get allClosed() {
    return this.cases.every((c) => c.closed);
  }

  isOpen(c: Case) {
    return this.cases.indexOf(c) < this.opened;
  }

  /** the soonest due open case; otherwise open the next unopened one; otherwise the soonest case at all */
  next(): Case | null {
    const live = this.cases.slice(0, this.opened).filter((c) => !c.closed).sort((a, b) => a.due - b.due);
    if (live[0] && live[0].due <= this.turn) return live[0];
    if (this.opened < this.cases.length) return this.cases[this.opened++];
    return live[0] ?? null;
  }

  /** record an answer and move the case along */
  settle(c: Case, ok: boolean) {
    if (c.step === 'guess') {
      c.guessed = ok;
      c.step = 'listen';
      c.due = this.turn + GAP.guess;
    } else if (!ok) {
      c.misses++;
      c.step = 'listen';
      c.due = this.turn + GAP.miss;
    } else if (c.step === 'listen') {
      c.step = 'recall';
      c.due = this.turn + GAP.listen;
    } else {
      c.closed = true;
    }
    this.turn++;
  }
}

/**
 * Words the player can be expected to read inside the sentence, longest match first, skipping the
 * case word itself. These are the detective's clues, and the source of the decoy answer.
 */
export function sentenceClues(w: Word, known: Map<string, Word>): Word[] {
  const zh = w.ex.zh;
  const at = zh.indexOf(w.h);
  const end = at + w.h.length;
  const out = new Map<string, Word>();
  for (let i = 0; i < zh.length; ) {
    if (i === at) {
      i = end;
      continue;
    }
    let hit: Word | undefined;
    for (let n = Math.min(4, (i < at ? at : zh.length) - i); n >= 1 && !hit; n--) hit = known.get(zh.slice(i, i + n));
    if (hit && hit.h !== w.h && usable(hit)) out.set(hit.h, hit);
    i += hit ? hit.h.length : 1;
  }
  return [...out.values()];
}

const sameMeaning = (a: Word, b: Word) => a.th === b.th || a.en.toLowerCase() === b.en.toLowerCase();

/**
 * Meaning choices for the guess step. One decoy is a word that really is in the sentence, so its
 * meaning also shows in the translation: the player has to work out which part the glowing word is.
 */
export function meaningChoices(w: Word, clues: Word[], pool: Word[]): Word[] {
  const out: Word[] = [w];
  const fits = (x: Word) => !out.some((o) => o.h === x.h || sameMeaning(o, x) || o.th.includes(x.th) || x.th.includes(o.th));
  const decoy = shuffle(clues.slice()).find(fits);
  if (decoy) out.push(decoy);
  for (const x of shuffle(pool.slice())) {
    if (out.length >= 4) break;
    if (usable(x) && !w.ex.zh.includes(x.h) && fits(x)) out.push(x);
  }
  return shuffle(out);
}

/** hanzi choices for listen and recall: the other open cases first (the real confusion), then same-length words */
export function hanziChoices(w: Word, rivals: Word[], pool: Word[]): Word[] {
  const out: Word[] = [w];
  const fits = (x: Word) => !out.some((o) => o.h === x.h || sameMeaning(o, x)) && !x.h.includes(w.h) && !w.h.includes(x.h);
  for (const x of shuffle(rivals.slice())) if (out.length < 3 && fits(x)) out.push(x);
  const len = [...w.h].length;
  for (const strict of [true, false]) {
    for (const x of shuffle(pool.slice())) {
      if (out.length >= 4) break;
      if (fits(x) && (!strict || [...x.h].length === len)) out.push(x);
    }
  }
  return shuffle(out);
}
