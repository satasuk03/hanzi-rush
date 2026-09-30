import gsap from 'gsap';
import { h } from '../core/util';
import { i18n } from '../core/i18n';
import { store } from '../core/store';
import { audio } from '../engine/audio';
import { pop, pressable } from '../engine/juice';

export const ICON = {
  sound: `<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5c1.5 1.2 1.5 5.8 0 7M18.5 6c3 2.5 3 9.5 0 12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  mute: `<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  back: `<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.2" height="14" rx="1.6" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.6" fill="currentColor"/></svg>`,
  lock: `<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="#ffc93c" stroke="#2a1a3a" stroke-width="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="#2a1a3a" stroke-width="2.4"/></svg>`,
  speaker: `<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5c1.5 1.2 1.5 5.8 0 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  heart: `<svg viewBox="0 0 32 30"><path d="M16 28S2 19.5 2 10.2C2 5.6 5.4 2 9.6 2c2.7 0 5 1.5 6.4 3.8C17.4 3.5 19.7 2 22.4 2 26.6 2 30 5.6 30 10.2 30 19.5 16 28 16 28z" fill="#ff4757" stroke="#2a1a3a" stroke-width="3" stroke-linejoin="round"/><ellipse cx="9.5" cy="9" rx="2.6" ry="3.6" fill="#fff" opacity=".7" transform="rotate(-25 9.5 9)"/></svg>`,
  coin: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#ffc93c" stroke="#2a1a3a" stroke-width="3"/><circle cx="16" cy="16" r="9" fill="none" stroke="#e8930c" stroke-width="2"/><rect x="12.5" y="12.5" width="7" height="7" rx="1" fill="#2a1a3a"/></svg>`,
  flame: `<svg viewBox="0 0 24 28"><path d="M12 2c1 5 7 7 7 14a7 7 0 0 1-14 0c0-4 2-6 3-8 0 3 1.5 4.5 3 5-1-4 0-8 1-11z" fill="#ff7a1f" stroke="#2a1a3a" stroke-width="2.4" stroke-linejoin="round"/><path d="M12 14c.5 2.5 3 3.5 3 6.5a3 3 0 0 1-6 0c0-2 1.5-3.2 3-6.5z" fill="#ffe14d"/></svg>`,
  crown: `<svg viewBox="0 0 28 22"><path d="M3 18L2 5l7 6 5-9 5 9 7-6-1 13z" fill="#ffc93c" stroke="#2a1a3a" stroke-width="2.6" stroke-linejoin="round"/></svg>`,
};

/** EN/TH pill toggle with sliding knob (top-right on every screen). */
export function langToggle() {
  const knob = h('span', { class: 'lt-knob' });
  const el = h('button', { class: 'lang-toggle', 'aria-label': 'Language' }, knob, h('span', { class: 'lt-opt', 'data-l': 'en' }, 'EN'), h('span', { class: 'lt-opt', 'data-l': 'th' }, 'TH'));
  const sync = (animate: boolean) => {
    const th = i18n.lang === 'th';
    el.classList.toggle('is-th', th);
    gsap.to(knob, { xPercent: th ? 100 : 0, duration: animate ? 0.5 : 0, ease: 'elastic.out(1.1,0.5)' });
  };
  sync(false);
  pressable(el, () => {
    audio.pop(i18n.lang === 'th' ? 1.2 : 0.9);
    i18n.set(i18n.lang === 'th' ? 'en' : 'th');
    sync(true);
    pop(knob, 1.2);
  });
  return el;
}

export function muteButton() {
  const el = h('button', { class: 'icon-btn', 'aria-label': 'Sound' });
  const sync = () => (el.innerHTML = store.settings.sound ? ICON.sound : ICON.mute);
  sync();
  pressable(el, () => {
    audio.unlock();
    audio.setMuted(store.settings.sound);
    sync();
    audio.pop();
    pop(el);
  });
  return el;
}

export function iconButton(icon: string, label: string, onTap: (e: PointerEvent) => void) {
  const el = h('button', { class: 'icon-btn', 'aria-label': label, html: icon });
  pressable(el, (e) => {
    audio.click();
    onTap(e);
  });
  return el;
}

/** Hefty cartoon button. */
export function bigButton(content: Node | string, color: string, onTap: (e: PointerEvent) => void, cls = '') {
  const el = h('button', { class: `big-btn ${cls}`, style: `--c:${color}` }, h('span', { class: 'big-btn-label' }, content));
  pressable(el, (e) => {
    audio.pop();
    onTap(e);
  });
  return el;
}
