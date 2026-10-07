/**
 * The one place that turns a Look into pixels (docs/cosmetics-shop.md §6.1). Used by the boards, the home chip and the
 * profile card. Imported by the leaderboard, so it stays small and knows nothing about the shop.
 *
 * With no look equipped the output is exactly the old hand-drawn seal (the title glyph on a tier-coloured disc), built
 * from the same classes (`pc-seal`, `lb-seal`, `pf-glyph`). Every look goes through sanitizeLook() first, so ids this
 * build does not know (a newer app, a retired item) render the default and never throw.
 */
import './identity.css';
import { AVATAR_PREFIX, itemById, sanitizeLook, type Look } from '../../shared/cosmetics';
import { h } from '../core/util';

/** S: board row (34 px) · M: home chip (38 px) · L: profile card (84 px disc) */
export type IdentitySize = 'S' | 'M' | 'L';

export interface IdentityOpts {
  /** the equipped title: its first glyph is the default avatar and its tier colours the seal */
  title: { zh: string; tier: number };
}

const BASE = { S: 'pc-seal lb-seal', M: 'pc-seal', L: 'pf-glyph' } as const;
const PX = { S: 34, M: 38, L: 84 } as const;

export const avatarSrc = (id: string): string => `${import.meta.env.BASE_URL}avatars/${id.slice(AVATAR_PREFIX.length)}.webp`;

/** (Re)draws `el` in place. Replaces its children, so a caller that adds its own (the level pip) appends them again. */
export function paintIdentity(el: HTMLElement, look: Look | undefined, size: IdentitySize, opts: IdentityOpts): void {
  const l = sanitizeLook(look);
  el.className = `${BASE[size]}${l.avatar ? ' id-img' : ''}${l.frame ? ' id-fr' : ''}`;
  if (l.frame) el.dataset.fr = l.frame;
  else delete el.dataset.fr;
  if (l.avatar) {
    delete el.dataset.t;
    const img = h('img', { class: 'id-av', src: avatarSrc(l.avatar), alt: '', width: String(PX[size]), height: String(PX[size]), loading: 'lazy', decoding: 'async', draggable: 'false' });
    // a build that ships without the file (or a stale cache): fall back to the default seal
    img.addEventListener('error', () => paintIdentity(el, { ...l, avatar: undefined }, size, opts), { once: true });
    el.replaceChildren(img);
  } else {
    el.dataset.t = String(opts.title.tier);
    el.replaceChildren(opts.title.zh[0]);
  }
}

export function renderIdentity(look: Look | undefined, size: IdentitySize, opts: IdentityOpts): HTMLElement {
  const el = h('span');
  paintIdentity(el, look, size, opts);
  return el;
}

/** Marks a name element with the equipped name effect. `animate` is for the top 10 and "me" only (§6.3). */
export function applyNameFx(el: HTMLElement, look: Look | undefined, animate = false): void {
  const fx = sanitizeLook(look).nameFx;
  if (!fx) return;
  el.classList.add('nfx');
  if (animate) el.classList.add('nfx-anim');
  el.dataset.fx = fx;
}

/** The equipped badges as small seals, or null when there are none. A row shows only the first (§6.3). */
export function renderBadges(look: Look | undefined, size: IdentitySize): HTMLElement | null {
  const badges = sanitizeLook(look).badges;
  if (!badges) return null;
  return h(
    'span',
    { class: 'id-badges' },
    ...badges.slice(0, size === 'L' ? badges.length : 1).map((id) => {
      const it = itemById(id)!;
      return h('span', { class: 'id-badge', 'data-b': id, 'data-r': String(it.rarity), title: it.en }, it.zh[0]);
    }),
  );
}
