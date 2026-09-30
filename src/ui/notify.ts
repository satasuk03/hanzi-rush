/** Lacquer-and-gold toasts for unlocks (titles, level ups). They stack under the top bar. */
import gsap from 'gsap';
import { h } from '../core/util';
import { audio } from '../engine/audio';

let stack: HTMLElement | null = null;

export function notify(o: { kicker: string; title: string; seal: string; tier?: number }, delay = 0) {
  if (!stack || !stack.isConnected) {
    stack = h('div', { class: 'notify-stack' });
    document.getElementById('overlay')!.append(stack);
  }
  const el = h(
    'div',
    { class: 'notify', 'data-t': String(o.tier ?? 3) },
    h('span', { class: 'nt-seal' }, o.seal),
    h('span', { class: 'nt-text' }, h('span', { class: 'nt-kicker' }, o.kicker), h('span', { class: 'nt-title' }, o.title)),
  );
  const host = stack;
  gsap.delayedCall(delay, () => {
    host.append(el);
    audio.bell(880, 0, 0.12);
    gsap.timeline({ onComplete: () => el.remove() })
      .fromTo(el, { y: -80, opacity: 0, scale: 0.8 }, { y: 0, opacity: 1, scale: 1, duration: 0.55, ease: 'back.out(1.8)' })
      .to(el, { y: -30, opacity: 0, duration: 0.35, ease: 'power2.in' }, '+=2.8');
  });
}
