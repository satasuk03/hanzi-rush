/**
 * Equipping (docs/cosmetics-shop.md §5.1). The look lives in the save (`progress.profile.look`); store.save() makes
 * src/core/cloud.ts push it with PATCH /me/profile. Only owned items can be put on (the server checks too), and the
 * ownership answer comes from the cached inventory, so equipping works offline.
 */
import { LOOK_MAX_BADGES, itemById, sanitizeLook, type Look } from '../../shared/cosmetics';
import { store } from '../core/store';
import { wallet } from '../core/wallet';

export const currentLook = (): Look => sanitizeLook(store.progress.profile.look);

export function isEquipped(itemId: string): boolean {
  const it = itemById(itemId);
  if (!it) return false;
  const l = currentLook();
  return it.slot === 'badge' ? !!l.badges?.includes(itemId) : l[it.slot] === itemId;
}

function save(look: Look) {
  store.progress.profile.look = sanitizeLook(look);
  store.save();
}

/**
 * Puts the item on (a badge is added, the oldest badge drops off past LOOK_MAX_BADGES). Returns false when the item is
 * unknown or not owned.
 */
export function equipItem(itemId: string): boolean {
  const it = itemById(itemId);
  if (!it || !wallet.owns(itemId)) return false;
  const l = currentLook();
  if (it.slot === 'badge') {
    const badges = (l.badges ?? []).filter((b) => b !== itemId);
    badges.push(itemId);
    l.badges = badges.slice(-LOOK_MAX_BADGES);
  } else l[it.slot] = itemId;
  save(l);
  return true;
}

/** Takes the item off (back to the slot's default). */
export function unequipItem(itemId: string): void {
  const it = itemById(itemId);
  if (!it) return;
  const l = currentLook();
  if (it.slot === 'badge') l.badges = l.badges?.filter((b) => b !== itemId);
  else if (l[it.slot] === itemId) delete l[it.slot];
  save(l);
}
