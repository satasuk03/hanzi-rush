import type { PlayerCardStats, SaveDoc } from '../shared/api';
import { levelOf } from '../shared/level';
import { TITLE_DEFS } from '../shared/titles';

const KNOWN_TITLES = new Set(TITLE_DEFS.map((d) => d.id));

/**
 * `players.card`: the display-only numbers of a player card, derived from a validated save. Titles unlocked are
 * evaluated on the client, so the server counts the ones the player has already been told about (`profile.seen`).
 */
export function buildCard(doc: SaveDoc): PlayerCardStats {
  const p = doc.progress;
  return {
    level: levelOf(p.xp).level,
    words: Object.keys(p.cards).length,
    games: p.stats.games,
    correct: p.stats.correct,
    questions: p.stats.questions,
    bestCombo: p.stats.bestCombo,
    bestStreak: p.daily.best,
    titles: new Set(p.profile.seen.filter((id) => KNOWN_TITLES.has(id))).size,
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
