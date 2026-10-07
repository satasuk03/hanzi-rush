/** Daily login pop-up: 7-day reward strip, claim button, streak flame. */
import gsap from 'gsap';
import { h, center } from '../core/util';
import { t, tx } from '../core/i18n';
import { claimDaily, dailyStatus, DAILY_REWARDS } from '../core/meta';
import { audio } from '../engine/audio';
import { particles } from '../engine/particles';
import { shake } from '../engine/shake';
import { pressable, popIn } from '../engine/juice';
import { ICON } from './widgets';
import { announceTitles } from './notify';

/** Shows the pop-up when today's reward is unclaimed. `onClaim` fires after the coins are paid. */
export function maybeShowDaily(onClaim: () => void) {
  const s = dailyStatus();
  if (!s.claimable) return;

  const cells = DAILY_REWARDS.map((c, i) => {
    const cls = i < s.slot ? 'done' : i === s.slot ? 'now' : '';
    return h(
      'div',
      { class: `daily-cell ${i === 6 ? 'big' : ''} ${cls}` },
      h('span', {}, `${t('dailyDay')} ${i + 1}`),
      h('span', { html: i < s.slot ? '✔' : ICON.coin }),
      h('b', {}, String(c)),
    );
  });
  const sub = h('p', { class: 'daily-sub' }, h('span', { html: ICON.flame }), `${s.next} `, tx('dailyStreak'));
  const btn = h('button', { class: 'daily-claim' }, tx('dailyClaim'));
  const card = h('div', { class: 'modal-card' }, h('h2', { class: 'modal-title' }, tx('dailyTitle')), sub, h('div', { class: 'daily-grid' }, ...cells), btn);
  const el = h('div', { class: 'modal' }, card);
  document.getElementById('overlay')!.append(el);

  gsap.from(el, { opacity: 0, duration: 0.25 });
  gsap.from(card, { scale: 0.6, y: 60, duration: 0.6, ease: 'back.out(1.8)' });
  popIn(cells, 0.25, 0.05);

  let done = false;
  pressable(btn, () => {
    if (done) return;
    done = true;
    const r = claimDaily();
    if (!r) return el.remove();
    audio.pop(1.3);
    const c = center(btn);
    particles.burst(c.x, c.y, { count: 26, sprite: ['coin', 'star'], speed: [250, 650], size: [16, 28], g: 900 });
    shake(0.3);
    onClaim();
    announceTitles(r.titles, 0.9, 0.4);
    gsap.to(el, { opacity: 0, duration: 0.3, delay: 0.5, onComplete: () => el.remove() });
  });
}
