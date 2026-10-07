/**
 * Shop drops as ceremony reveals (docs/cosmetics-shop.md §5.5). The face is a canvas display case (treasureArt.ts) with
 * the live item laid on its cushion once it is up: avatars as the image, frames on the player's own disc, name
 * effects on the player's name (on a light chip: namefx.css colours are for light backgrounds), badges through
 * renderBadges(). Items this build does not know (a newer server) show a "?" and never throw.
 */
import './shop.css';
import type { ShopDrop, ShopPullResponse } from '../../../shared/api';
import { itemById, type BoxDef, type Item, type Look } from '../../../shared/cosmetics';
import { h } from '../../core/util';
import { t, i18n, type Key } from '../../core/i18n';
import { store } from '../../core/store';
import { newTitles, titleById } from '../../core/meta';
import { audio } from '../../engine/audio';
import { pop, pressable } from '../../engine/juice';
import { ICON } from '../../ui/widgets';
import { applyNameFx, avatarSrc, renderBadges, renderIdentity } from '../../cosmetics/render';
import { currentLook, equipItem, isEquipped, unequipItem } from '../../cosmetics/equip';
import { COSMETIC_STAGE } from './cardArt';
import { drawTreasureBack, drawTreasureFront } from './treasureArt';
import type { Price, Reveal, RevealBatch } from './opening';

const SLOT_KEY: Record<Item['slot'], Key> = { frame: 'slotFrame', avatar: 'slotAvatar', nameFx: 'slotNameFx', badge: 'slotBadge' };

const clampR = (r: number) => Math.max(0, Math.min(4, Math.round(r) || 0));

/** a short sample that fits a tile: the player's name when it is short, else a fixed one */
const sampleName = () => {
  const n = (store.progress.profile.name || '').trim();
  return n && [...n].length <= 6 ? n : 'Aa 字';
};

/** the item drawn live: the player's own disc and name, wearing just this item */
export function itemArt(it: Item | undefined): HTMLElement {
  const title = titleById(store.progress.profile.title);
  if (!it) return h('span', { class: 'ca ca-unknown' }, h('span', { class: 'pf-glyph' }, '?'));
  const mine = currentLook();
  switch (it.slot) {
    case 'avatar':
      return h('span', { class: 'ca ca-disc' }, renderIdentity({ avatar: it.id }, 'L', { title }));
    case 'frame':
      return h('span', { class: 'ca ca-disc' }, renderIdentity({ avatar: mine.avatar, frame: it.id }, 'L', { title }));
    case 'nameFx': {
      const name = h('span', { class: 'ca-name' }, sampleName());
      applyNameFx(name, { nameFx: it.id } satisfies Look, true);
      return h('span', { class: 'ca ca-chip' }, name);
    }
    case 'badge':
      return h('span', { class: 'ca ca-badge' }, renderBadges({ badges: [it.id] }, 'L') ?? '?');
  }
}

/** shared by every reveal of one batch: equipping one item can take another off (same slot) */
type Sync = Set<() => void>;

function equipToggle(id: string, sync: Sync, el: HTMLElement) {
  if (isEquipped(id)) unequipItem(id);
  else if (!equipItem(id)) return;
  audio.pop(1.3);
  pop(el, 0.6);
  sync.forEach((f) => f());
}

function cosmeticReveal(d: ShopDrop, sync: Sync): Reveal {
  const it = itemById(d.itemId);
  const rarity = clampR(it?.rarity ?? d.rarity);
  const name = () => (it ? it[i18n.lang] : t('itemUnknown'));
  return {
    rarity,
    isNew: d.isNew,
    copies: d.copies,
    refund: d.refund,
    paint: (w) => drawTreasureFront(document.createElement('canvas'), w, rarity, { key: d.itemId, zh: it?.zh ?? '？', name: name(), kind: it ? t(SLOT_KEY[it.slot]) : '' }, i18n.lang),
    layer() {
      const el = h('div', { class: 'cos-stage', style: `top:${COSMETIC_STAGE.y * 100}%` }, itemArt(it));
      return el;
    },
    extra() {
      if (!it) return null;
      const b = h('button', { class: 'vs-extra cos-equip' });
      const paint = () => {
        const on = isEquipped(it.id);
        b.classList.toggle('on', on);
        b.textContent = on ? `✓ ${t('equipped')}` : t('equip');
      };
      paint();
      sync.add(paint);
      pressable(b, () => equipToggle(it.id, sync, b));
      return b;
    },
    tile() {
      const pill = h('span', { class: 'ct-eq' });
      const m = h(
        'button',
        { class: 'mc ct', 'data-r': String(rarity) },
        h('span', { class: 'ct-case' }),
        h('span', { class: 'ct-art' }, itemArt(it)),
        h('span', { class: 'ct-name' }, name()),
        it ? pill : null,
        h('span', { class: 'mc-band' }, h('span', { class: 'mc-stars' }, '★'.repeat(rarity + 1))),
        d.isNew ? h('span', { class: 'mc-new' }, 'NEW') : null,
        d.copies > 1 ? h('span', { class: 'mc-x' }, `×${d.copies}`) : null,
      );
      if (it) {
        const paint = () => {
          const on = isEquipped(it.id);
          pill.classList.toggle('on', on);
          pill.textContent = on ? '✓' : t('equip');
        };
        paint();
        sync.add(paint);
        pressable(m, () => equipToggle(it.id, sync, m));
      }
      return m;
    },
  };
}

/** fonts for the canvas faces and the avatar images, so nothing pops in late (capped like loadCardFonts) */
function ready(items: (Item | undefined)[]) {
  const zh = items.map((i) => i?.zh ?? '').join('') + '普通稀有史诗传说神话';
  const th = items.map((i) => i?.th ?? '').join('') + 'ก';
  const latin = items.map((i) => i?.en ?? '').join('') + 'FRAMEAVATARNAMESTYLEBADGECOMMONRAREEPICLEGENDARYMYTHIC';
  const imgs = items
    .filter((i): i is Item => i?.slot === 'avatar')
    .map((i) => new Promise<void>((r) => {
      const im = new Image();
      im.onload = im.onerror = () => r();
      im.src = avatarSrc(i.id);
    }));
  return Promise.race([
    Promise.all([
      document.fonts.load(`40px "Ma Shan Zheng"`, zh),
      document.fonts.load(`700 20px "Noto Serif SC"`, latin),
      document.fonts.load(`20px "Lilita One"`, latin),
      document.fonts.load(`700 20px "Noto Serif Thai"`, th),
      ...imgs,
    ]),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
}

export function cosmeticBatch(box: BoxDef, res: ShopPullResponse): RevealBatch {
  const sync: Sync = new Set();
  let back: { width: number; cv: HTMLCanvasElement } | null = null;
  const reveals = res.drops.map((d) => cosmeticReveal(d, sync));
  return {
    reveals,
    best: Math.max(0, ...reveals.map((r) => r.rarity)),
    label: box.zh,
    ready: ready(res.drops.map((d) => itemById(d.itemId))),
    // titles that count cosmetics (`wardrobe`) are evaluated from wallet.inventory, which the pull just updated
    titles: newTitles(),
    back: (w) => {
      // painted once per batch and size, copied per card (the flipper takes ownership of each canvas)
      if (!back || back.width !== w) back = { width: w, cv: drawTreasureBack(document.createElement('canvas'), w, box.id) };
      const cv = document.createElement('canvas');
      cv.width = back.cv.width;
      cv.height = back.cv.height;
      cv.style.cssText = back.cv.style.cssText;
      cv.getContext('2d')!.drawImage(back.cv, 0, 0);
      return cv;
    },
  };
}

export const jadePrice = (amount: number): Price => ({ icon: ICON.jade, amount });
