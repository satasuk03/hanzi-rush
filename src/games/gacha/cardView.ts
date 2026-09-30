/** Full-screen card inspector: big holo card + listen, copies and first-found date. */
import gsap from 'gsap';
import type { Word } from '../../core/data';
import { h, center } from '../../core/util';
import { tx, i18n } from '../../core/i18n';
import { RARITIES } from '../../core/rarity';
import { audio, speak } from '../../engine/audio';
import { particles } from '../../engine/particles';
import { pressable } from '../../engine/juice';
import { ICON } from '../../ui/widgets';
import { drawCardFront, loadCardFonts, CARD_RATIO } from './cardArt';
import { gcard } from './gcard';
import { SPARK } from './fx';

export interface CardViewOpts {
  word: Word;
  level: number;
  no: number;
  rarity: number;
  copies: number;
  first?: number;
}

export async function openCardView(o: CardViewOpts) {
  await loadCardFonts([o.word]);
  const width = Math.min(innerWidth * 0.84, 360, (innerHeight - 190) / CARD_RATIO);
  const paint = () => drawCardFront(document.createElement('canvas'), width, o.word, o.rarity, { level: o.level, no: o.no }, i18n.lang);
  const card = gcard(width, o.rarity, paint(), true);
  const R = RARITIES[o.rarity];

  const say = h('button', { class: 'cv-btn say', 'aria-label': 'Listen', html: ICON.speaker });
  const close = h('button', { class: 'cv-btn close', 'aria-label': 'Close', html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>' });
  const pips = h('span', { class: 'cv-pips' }, ...Array.from({ length: 5 }, (_, i) => h('i', { class: i < Math.min(5, o.copies) ? 'on' : '' })));
  const meta = h(
    'div',
    { class: 'cv-meta' },
    h('span', { class: 'cv-rar' }, h('span', { class: 'tier-chip', 'data-r': String(o.rarity) }, R.name), h('b', null, R.zh)),
    h('span', { class: 'cv-copies' }, tx('copies'), ` ×${o.copies}`, pips),
    o.first ? h('span', { class: 'cv-date' }, tx('firstFound'), ` · ${new Date(o.first * 1000).toLocaleDateString(i18n.lang === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`) : null,
  );
  const el = h('div', { class: 'cv-modal', role: 'dialog' }, h('div', { class: 'cv-stage' }, card.el), h('div', { class: 'cv-bar' }, say, meta, close));
  document.getElementById('app')!.append(el);

  const offLang = i18n.onChange(() => card.setFace(paint(), true));
  const shut = () => {
    offLang();
    audio.swoosh();
    gsap.to(card.el, { scale: 0.7, y: 40, opacity: 0, duration: 0.25, ease: 'power2.in' });
    gsap.to(el, { opacity: 0, duration: 0.3, onComplete: () => (card.destroy(), el.remove()) });
  };
  pressable(say, () => {
    audio.pop(1.2);
    speak(o.word.h, true);
  });
  pressable(close, shut);
  el.addEventListener('pointerup', (e) => {
    if (e.target === el || (e.target as HTMLElement).classList.contains('cv-stage')) shut();
  });

  gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.25 });
  gsap.fromTo(card.el, { scale: 0.5, rotation: -8, y: 60 }, { scale: 1, rotation: 0, y: 0, duration: 0.7, ease: 'elastic.out(1,0.6)' });
  gsap.from(el.querySelector('.cv-bar')!, { y: 80, opacity: 0, duration: 0.5, delay: 0.1, ease: 'back.out(1.8)' });
  audio.pop(0.9 + o.rarity * 0.1);
  requestAnimationFrame(() => {
    const c = center(card.body);
    particles.burst(c.x, c.y, { count: 10 + o.rarity * 8, sprite: SPARK[o.rarity], speed: [200, 520], size: [12, 22], g: 200, drag: 2.4, life: [0.4, 0.8], add: true, stretch: true });
  });
  speak(o.word.h);
}
