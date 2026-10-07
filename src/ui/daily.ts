/**
 * Daily login pop-up (每日签到): a row of 红包 red envelopes, one per day of the 7-day cycle, with a gold treasure chest
 * on day 7. Claimed days are opened and stamped, today's envelope glows and wiggles, Deng Deng peeks over the card.
 * Claiming tears today's envelope open: the flap flips, the stamp lands, coins and Jade fly out.
 */
import gsap from 'gsap';
import { h, center } from '../core/util';
import { t, tx } from '../core/i18n';
import { claimDaily, dailyStatus, DAILY_REWARDS } from '../core/meta';
import { audio } from '../engine/audio';
import { particles } from '../engine/particles';
import { shake } from '../engine/shake';
import { pressable, popIn } from '../engine/juice';
import { ICON } from './widgets';
import { announceTitles, notify } from './notify';
import { mascot, setMood } from './mascot';
import { wallet } from '../core/wallet';
import { JADE_DAILY } from '../../shared/api';
import { chestSVG } from '../games/gacha/chest';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Shows the pop-up when today's reward is unclaimed. `onClaim` fires after the coins are paid. */
export function maybeShowDaily(onClaim: () => void) {
  const s = dailyStatus();
  if (!s.claimable) return;

  const rewards = (i: number) =>
    h(
      'span',
      { class: 'dc-rewards' },
      h('span', { class: 'dc-row' }, h('span', { html: ICON.coin }), h('b', {}, String(DAILY_REWARDS[i]))),
      h('span', { class: 'dc-row jade', 'aria-label': t('jade') }, h('span', { html: ICON.jade }), h('b', {}, String(JADE_DAILY[i]))),
    );
  const stamp = () => h('span', { class: 'env-stamp', 'aria-hidden': 'true' }, '✓');

  const cells = DAILY_REWARDS.map((_, i) => {
    const state = i < s.slot ? 'done' : i === s.slot ? 'now' : 'later';
    const day = h('span', { class: 'env-day' }, `${t('dailyDay')} ${i + 1}`);
    const el =
      i === 6
        ? h('div', { class: `daily-cell env big ${state}` }, h('span', { class: 'env-chest', html: chestSVG('supreme', 'env-chest-svg', true) }), h('span', { class: 'env-big-txt' }, day, rewards(i)))
        : h('div', { class: `daily-cell env ${state}` }, h('span', { class: 'env-flap' }), day, h('span', { class: 'env-seal' }, '福'), rewards(i));
    if (state === 'done') el.append(stamp());
    return el;
  });
  const today = cells[s.slot];

  const buddy = mascot('happy');
  buddy.classList.add('daily-mascot');
  const head = h(
    'div',
    { class: 'daily-head' },
    h('div', { class: 'daily-ribbon' }, h('span', { class: 'daily-ribbon-zh' }, '每日签到')),
    h('h2', { class: 'modal-title' }, tx('dailyTitle')),
  );
  const sub = h('p', { class: 'daily-sub' }, h('span', { html: ICON.flame }), h('b', {}, String(s.next)), ' ', tx('dailyStreak'));
  const btn = h('button', { class: 'daily-claim' }, h('span', { class: 'daily-claim-shine' }), tx('dailyClaim'));
  const card = h('div', { class: 'modal-card daily-card' }, buddy, head, sub, h('div', { class: 'daily-grid' }, ...cells), btn);
  const el = h('div', { class: 'modal' }, card);
  document.getElementById('overlay')!.append(el);

  gsap.from(el, { opacity: 0, duration: 0.25 });
  gsap.from(card, { scale: 0.6, y: 60, duration: 0.6, ease: 'back.out(1.8)' });
  gsap.from(buddy, { y: 70, rotation: 20, opacity: 0, duration: 0.7, delay: 0.35, ease: 'back.out(2.2)' });
  popIn(cells, 0.25, 0.05);
  const idle: gsap.core.Animation[] = [];
  if (!reduced()) {
    idle.push(gsap.to(buddy, { y: -5, rotation: -14, duration: 1.3, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 1 }));
    // today's envelope wiggles for attention
    idle.push(gsap.timeline({ repeat: -1, repeatDelay: 1.6, delay: 1.1 }).to(today, { rotation: -6, duration: 0.08 }).to(today, { rotation: 6, duration: 0.1, yoyo: true, repeat: 3 }).to(today, { rotation: 0, duration: 0.2, ease: 'back.out(3)' }));
  }

  let done = false;
  pressable(btn, () => {
    if (done) return;
    done = true;
    const r = claimDaily();
    if (!r) return el.remove();
    idle.forEach((a) => a.kill());
    gsap.set([today, buddy], { rotation: 0 });
    audio.pop(1.3);
    shake(0.3);
    btn.classList.add('used');

    // the envelope (or the chest) opens
    const flap = today.querySelector('.env-flap');
    if (flap) gsap.to(flap, { scaleY: -1, duration: 0.35, ease: 'back.out(2)' });
    const svg = today.querySelector('svg');
    if (svg) {
      gsap.to(svg.querySelector('.cab-lock'), { y: 40, rotation: 50, opacity: 0, duration: 0.4, svgOrigin: '120 168' });
      gsap.to(svg.querySelector('.ch-lid'), { y: -40, rotation: -12, opacity: 0, duration: 0.45, svgOrigin: '120 136' });
      gsap.to(svg.querySelector('.cab-inside'), { opacity: 1, duration: 0.2 });
    }
    gsap.fromTo(today, { scale: 1 }, { scale: 1.12, duration: 0.15, yoyo: true, repeat: 1, ease: 'power2.out' });
    const c = center(today);
    particles.burst(c.x, c.y, { count: 22, sprite: ['coin', 'coin', 'yuanbao'], speed: [300, 700], size: [18, 28], g: 1100, angle: -Math.PI / 2, spread: 2, spin: true });
    particles.burst(c.x, c.y, { count: 14, sprite: ['sparkCyan', 'sparkGold', 'star'], speed: [150, 450], size: [14, 24], g: 200, drag: 1.5, life: [0.5, 0.9], add: true });
    particles.ring(c.x, c.y, 120, '#ffd66b', 4, 0.45);

    // the stamp lands
    const st = stamp();
    today.append(st);
    today.classList.remove('now');
    today.classList.add('done', 'just');
    gsap.fromTo(st, { scale: 2.6, opacity: 0, rotation: -40 }, { scale: 1, opacity: 1, rotation: -14, duration: 0.35, delay: 0.25, ease: 'back.out(2.5)', onStart: () => audio.pop(0.8) });

    setMood(buddy, 'wow');
    gsap.fromTo(buddy, { y: 0 }, { y: -26, duration: 0.22, yoyo: true, repeat: 1, ease: 'power2.out', onComplete: () => setMood(buddy, 'happy') });

    onClaim();
    announceTitles(r.titles, 0.9, 0.4);
    // the Jade half goes to the server with the same tap; offline it stays queued and the coins above are unaffected
    void wallet.claimDaily().then((j) => {
      if (j && j.granted > 0 && !j.replay) notify({ kicker: t('jadeDailyKicker'), title: `+${j.granted} ${t('jade')}`, seal: '玉', tier: 2 }, 0.5);
    });
    gsap.to(el, { opacity: 0, duration: 0.3, delay: 1.25, onComplete: () => el.remove() });
  });
}
