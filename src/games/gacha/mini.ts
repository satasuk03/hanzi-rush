/**
 * Small DOM card tiles for grids (ceremony summary, collection). A miniature of the big
 * card: tinted paper, a rarity ensō behind brush hanzi, a tiny seal, an inner frame, and a
 * tier band with stars at the foot. CSS-only apart from one shared ensō image per rarity.
 */
import type { Word } from '../../core/data';
import { h } from '../../core/util';
import { i18n } from '../../core/i18n';
import { RARITIES } from '../../core/rarity';
import { ensoTexture } from './cardArt';

export interface MiniOpts {
  no?: number;
  isNew?: boolean;
  copies?: number;
  meaning?: boolean;
}

let styled = false;
function injectArt() {
  if (styled) return;
  styled = true;
  const css = RARITIES.map((R) => `.mc[data-r='${R.i}'] .mc-art{background-image:url(${ensoTexture(R.i)})}`).join('');
  document.head.append(h('style', null, css));
}

const band = (r: number) =>
  h('span', { class: 'mc-band' }, h('span', { class: 'mc-stars' }, '★'.repeat(r + 1)));

export function miniCard(word: Word | null, rarity: number, o: MiniOpts = {}) {
  injectArt();
  if (!word) {
    return h(
      'button',
      { class: 'mc locked', 'data-r': String(rarity) },
      h('span', { class: 'mc-q' }, '?'),
      o.no ? h('span', { class: 'mc-no' }, String(o.no).padStart(3, '0')) : null,
      band(rarity),
    );
  }
  const len = [...word.h].length;
  return h(
    'button',
    { class: `mc len${Math.min(len, 4)}`, 'data-r': String(rarity) },
    h('span', { class: 'mc-art' }),
    h('span', { class: 'mc-frame' }),
    o.no ? h('span', { class: 'mc-no' }, String(o.no).padStart(3, '0')) : null,
    h('span', { class: 'mc-body' },
      h('span', { class: 'mc-hw' }, h('span', { class: 'mc-h' }, word.h), h('span', { class: 'mc-seal' }, RARITIES[rarity].seal)),
      h('span', { class: 'mc-p' }, word.p),
      o.meaning ? h('span', { class: 'mc-m' }, i18n.lang === 'th' ? word.th : word.en) : null),
    band(rarity),
    o.isNew ? h('span', { class: 'mc-new' }, 'NEW') : null,
    o.copies && o.copies > 1 ? h('span', { class: 'mc-x' }, `×${o.copies}`) : null,
  );
}
