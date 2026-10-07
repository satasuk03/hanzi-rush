/** Lacquer-and-gold toasts for unlocks (titles, level ups). They stack under the top bar. */
import gsap from 'gsap';
import { h } from '../core/util';
import { t, i18n } from '../core/i18n';
import type { Title } from '../core/meta';
import { audio } from '../engine/audio';

/** more unlocks than this at once (e.g. the first launch after new titles ship) collapse into one summary toast */
const MAX_TOASTS = 3;

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

/** Toast freshly unlocked titles: one each, or a single summary when there are many. */
export function announceTitles(list: Title[], delay = 0, gap = 0.5) {
  if (!list.length) return;
  if (list.length > MAX_TOASTS) {
    notify({ kicker: t('titleUnlocked'), title: t('titlesMany').replace('{n}', String(list.length)), seal: '称', tier: Math.max(...list.map((x) => x.tier)) }, delay);
    return;
  }
  list.forEach((T, i) => notify({ kicker: t('titleUnlocked'), title: `${T.zh} · ${T[i18n.lang]}`, seal: T.zh[0], tier: T.tier }, delay + i * gap));
}
