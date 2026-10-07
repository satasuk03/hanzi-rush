import { LOOK_MAX_BADGES, type Look } from '../shared/cosmetics';

/** Drops every item id the player does not own from an already-sanitized look. The inventory table is the truth. */
export async function ownedLook(db: D1Database, playerId: string, look: Look): Promise<Look> {
  const ids = [look.frame, look.avatar, look.nameFx, ...(look.badges ?? []).slice(0, LOOK_MAX_BADGES)].filter((x): x is string => !!x);
  if (!ids.length) return look;
  const uniq = [...new Set(ids)];
  const rows = await db
    .prepare(`SELECT item_id FROM inventory WHERE player_id = ?1 AND item_id IN (${uniq.map((_, i) => `?${i + 2}`).join(', ')})`)
    .bind(playerId, ...uniq)
    .all<{ item_id: string }>();
  const owned = new Set((rows.results ?? []).map((r) => r.item_id));
  const out: Look = {};
  if (look.frame && owned.has(look.frame)) out.frame = look.frame;
  if (look.avatar && owned.has(look.avatar)) out.avatar = look.avatar;
  if (look.nameFx && owned.has(look.nameFx)) out.nameFx = look.nameFx;
  const badges = (look.badges ?? []).filter((b) => owned.has(b));
  if (badges.length) out.badges = badges;
  return out;
}
