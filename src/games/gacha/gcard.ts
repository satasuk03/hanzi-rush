/**
 * A vault card on screen: the painted canvas plus live layers the canvas can't do.
 * Holo foil and glare follow the pointer, the card tilts a little, and a rarity aura
 * glows behind it. The tilt stays small (±9°). Big rotations go through the WebGL flipper.
 */
import gsap from 'gsap';
import { h } from '../../core/util';
import { RARITIES } from '../../core/rarity';
import { CARD_RATIO } from './cardArt';

export interface GCard {
  el: HTMLElement;
  /** the flat card box handed to the flipper */
  body: HTMLElement;
  cv: HTMLCanvasElement;
  rarity: number;
  setFace(cv: HTMLCanvasElement, up: boolean): void;
  setRarity(r: number): void;
  /** reset tilt to flat (before a WebGL flip measures the rect) */
  flatten(): void;
  destroy(): void;
}

export function gcard(width: number, rarity: number, face: HTMLCanvasElement, up = false): GCard {
  const w = Math.round(width);
  const hgt = Math.round(width * CARD_RATIO);
  const body = h('div', { class: 'gc-body' }, face, h('div', { class: 'gc-holo' }), h('div', { class: 'gc-glint' }), h('div', { class: 'gc-glare' }));
  const tilt = h('div', { class: 'gc-tilt' }, body);
  const el = h('div', { class: 'gcard', style: `--cw:${w}px;--ch:${hgt}px` }, h('div', { class: 'gc-rays' }), h('div', { class: 'gc-aura' }), tilt);
  const state = { rx: 0, ry: 0, mx: 50, my: 50 };
  const apply = () => {
    tilt.style.transform = `perspective(1100px) rotateX(${state.rx.toFixed(2)}deg) rotateY(${state.ry.toFixed(2)}deg)`;
    body.style.setProperty('--mx', `${state.mx.toFixed(1)}%`);
    body.style.setProperty('--my', `${state.my.toFixed(1)}%`);
  };

  const card: GCard = {
    el,
    body,
    cv: face,
    rarity,
    setFace(cv, isUp) {
      cv.classList.add('gc-cv');
      body.replaceChild(cv, card.cv);
      card.cv = cv;
      el.classList.toggle('up', isUp);
    },
    setRarity(r) {
      card.rarity = r;
      el.dataset.r = String(r);
      el.style.setProperty('--rc', RARITIES[r].color);
      el.style.setProperty('--rg', RARITIES[r].glow);
    },
    flatten() {
      gsap.killTweensOf(state);
      Object.assign(state, { rx: 0, ry: 0, mx: 50, my: 50 });
      apply();
    },
    destroy() {
      gsap.killTweensOf(state);
      idle.kill();
      el.remove();
    },
  };
  face.classList.add('gc-cv');
  card.setRarity(rarity);
  el.classList.toggle('up', up);

  // idle drift so the foil catches light even without a pointer
  const idle = gsap.to(state, { mx: 80, my: 30, duration: 2.6, yoyo: true, repeat: -1, ease: 'sine.inOut', onUpdate: apply, paused: true });
  let hovering = false;
  const syncIdle = () => (el.classList.contains('up') && !hovering ? idle.play() : idle.pause());
  new MutationObserver(syncIdle).observe(el, { attributes: true, attributeFilter: ['class'] });
  syncIdle();

  el.addEventListener('pointermove', (e) => {
    if (!el.classList.contains('up') || el.classList.contains('busy')) return;
    hovering = true;
    idle.pause();
    const r = body.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    gsap.to(state, { rx: (0.5 - py) * 18, ry: (px - 0.5) * 18, mx: px * 100, my: py * 100, duration: 0.35, ease: 'power2.out', onUpdate: apply, overwrite: true });
  });
  el.addEventListener('pointerleave', () => {
    hovering = false;
    gsap.to(state, { rx: 0, ry: 0, duration: 0.9, ease: 'elastic.out(1,0.5)', onUpdate: apply, overwrite: true, onComplete: syncIdle });
  });
  apply();
  return card;
}
