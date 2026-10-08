import type { PlayerCardStats, SaveDoc } from '../shared/api';
import { levelOf } from '../shared/level';
import { TITLE_DEFS, titleUnlocked } from '../shared/titles';
import { factsFromSave } from './titleFacts';

/**
 * `players.card`: the display-only numbers of a player card, derived from a validated save. Titles unlocked use the
 * shared evaluator. Pass the server inventory (item id -> copies) for exact `cosmetics` / `sets` titles; without it
 * those two kinds count only when the player was already told about them (`profile.seen`).
 */
export function buildCard(doc: SaveDoc, inventory?: ReadonlyMap<string, number>): PlayerCardStats {
  const p = doc.progress;
  const facts = factsFromSave(doc, inventory ?? new Map());
  const seen = new Set(p.profile.seen);
  return {
    level: levelOf(p.xp).level,
    words: Object.keys(p.cards).length,
    games: p.stats.games,
    correct: p.stats.correct,
    questions: p.stats.questions,
    bestCombo: p.stats.bestCombo,
    bestStreak: p.daily.best,
    titles: TITLE_DEFS.filter((d) => titleUnlocked(d, facts) || (!inventory && (d.req.k === 'cosmetics' || d.req.k === 'sets') && seen.has(d.id))).length,
  };
}

/** `players.card` JSON → stats; null when absent or unreadable */
export function parseCard(json: string | null | undefined): PlayerCardStats | null {
  if (!json) return null;
  try {
    const c = JSON.parse(json) as PlayerCardStats;
    return c && typeof c.level === 'number' ? c : null;
  } catch {
    return null;
  }
}
