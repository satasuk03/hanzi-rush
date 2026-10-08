/** The player level curve. Pure, so the client (src/core/meta.ts) and the server (player cards) agree. */
export interface LevelInfo {
  level: number;
  /** XP earned inside the current level */
  into: number;
  /** XP needed to clear the current level */
  need: number;
}

export const xpToNext = (L: number) => Math.round(60 * L ** 1.35 + 40);

export function levelOf(xp: number): LevelInfo {
  let level = 1;
  let rest = xp;
  while (rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, need: xpToNext(level) };
}
