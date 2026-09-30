import gsap from 'gsap';
import { h, center, formatNum, rand } from '../core/util';
import { tx, i18n } from '../core/i18n';
import type { Screen } from '../core/app';
import { app } from '../core/app';
import { store } from '../core/store';
import type { Word } from '../core/data';
import { loadLevel } from '../core/data';
import { audio, speak } from '../engine/audio';
import { particles } from '../engine/particles';
import { shake, punch } from '../engine/shake';
import { pop, pressable, countTo, loop, bob } from '../engine/juice';
import { langToggle, muteButton, bigButton, ICON } from '../ui/widgets';
import { mascot } from '../ui/mascot';
import { GAMES, bestKey, type Mode } from '../games/registry';
import { homeScreen } from './home';
import { levelsScreen } from './levels';

export interface RunStats {
  game: string;
  level: number;
  mode: Mode;
  score: number;
  correct: number;
  asked: number;
  maxCombo: number;
  missed: Word[];
  rush: boolean;
}

const STAR_SVG = `<svg viewBox="0 0 100 100"><path d="M50 6l13 28 30 4-22 21 6 30-27-15-27 15 6-30L7 38l30-4z" fill="currentColor" stroke="#2a1a3a" stroke-width="7" stroke-linejoin="round"/><ellipse cx="38" cy="36" rx="7" ry="4" fill="#fff" opacity=".7" transform="rotate(-35 38 36)"/></svg>`;

export function resultsScreen(r: RunStats): Screen {
  const game = GAMES.find((g) => g.id === r.game)!;
  const acc = r.asked ? r.correct / r.asked : 0;
  const starsEarned = r.correct === 0 ? 0 : acc >= 0.95 ? 3 : acc >= 0.8 ? 2 : acc >= 0.5 ? 1 : 0;
  const key = bestKey(r.game, r.level, r.mode);
  const prevBest = store.getBest(key);
  const isBest = r.score > 0 && store.submitBest(key, r.score);

  const buddy = mascot(starsEarned >= 2 ? 'happy' : starsEarned === 1 ? 'wow' : 'sad');
  const stars = [0, 1, 2].map((i) => h('span', { class: `r-star s${i}`, html: STAR_SVG }));
  const scoreV = h('span', { class: 'r-score-v' }, '0');
  const bestRibbon = h('div', { class: 'r-best' }, tx('newBest'));
  const stat = (k: Parameters<typeof tx>[0], v: string) => h('div', { class: 'r-stat' }, h('span', { class: 'r-stat-v' }, v), h('span', { class: 'r-stat-k' }, tx(k)));

  const missedList = h('div', { class: 'r-missed' });
  const renderMissed = () => {
    missedList.replaceChildren();
    if (!r.missed.length) {
      missedList.append(h('p', { class: 'r-perfect' }, tx('perfectRun')));
      return;
    }
    missedList.append(h('h3', { class: 'r-missed-title' }, tx('missed')));
    for (const w of r.missed) {
      const row = h(
        'button',
        { class: 'r-word' },
        h('span', { class: 'rw-h' }, w.h),
        h('span', { class: 'rw-mid' }, h('span', { class: 'rw-p' }, w.p), h('span', { class: 'rw-m' }, i18n.lang === 'th' ? w.th : w.en)),
        h('span', { class: 'rw-say', html: ICON.speaker }),
      );
      pressable(row, () => {
        audio.pop(1.2);
        speak(w.h, true);
      });
      missedList.append(row);
    }
  };
  renderMissed();
  const offLang = i18n.onChange(renderMissed);

  const panel = h(
    'div',
    { class: 'r-panel' },
    h('div', { class: 'r-head' }, h('span', { class: 'game-chip', style: `--c:${game.color}` }, tx(game.name)), h('span', { class: 'r-level' }, `HSK ${r.level} · `, tx(r.mode === 'rush' ? 'modeRush' : 'modeZen'))),
    h('div', { class: 'r-stars' }, ...stars),
    h('div', { class: 'r-score' }, h('span', { class: 'r-score-k' }, tx('score')), scoreV, bestRibbon, h('span', { class: 'r-prev' }, h('span', { html: ICON.crown }), ` ${formatNum(Math.max(prevBest, r.score))}`)),
    h('div', { class: 'r-stats' }, stat('correct', `${r.correct}/${r.asked}`), stat('accuracy', `${Math.round(acc * 100)}%`), stat('maxCombo', `×${r.maxCombo}`)),
    missedList,
  );

  const retry = bigButton(tx('retry'), '#5be35b', async (e) => {
    const words = await loadLevel(r.level);
    const mod = await game.load!();
    app.go(() => mod.create({ level: r.level, mode: r.mode, words }), { x: e.clientX, y: e.clientY });
  }, 'r-retry');
  const levels = bigButton(tx('levels'), '#3da5ff', (e) => app.go(() => levelsScreen(game), { x: e.clientX, y: e.clientY }));
  const home = bigButton(tx('home'), '#ff9a1f', (e) => app.go(homeScreen, { x: e.clientX, y: e.clientY }));

  const el = h(
    'div',
    { class: 'screen results' },
    h('div', { class: 'topbar' }, h('div', { class: 'spacer' }), muteButton(), langToggle()),
    h('div', { class: 'r-buddy' }, buddy),
    panel,
    h('div', { class: 'r-actions' }, levels, retry, home),
  );

  return {
    el,
    theme: 'results',
    enter() {
      gsap.set(stars, { scale: 0 });
      gsap.set(bestRibbon, { scale: 0 });
      gsap.from(panel, { y: innerHeight, duration: 0.7, ease: 'back.out(1.3)' });
      gsap.from(buddy, { scale: 0, duration: 0.8, delay: 0.3, ease: 'elastic.out(1,0.4)' });
      gsap.from(el.querySelector('.r-actions')!.children, { y: 120, duration: 0.6, delay: 0.5, stagger: 0.08, ease: 'back.out(1.6)' });
      loop('res:buddy', buddy, () => bob(buddy, 8, 1.2), { y: 0 });

      const tl = gsap.timeline({ delay: 0.6 });
      // stars slam in one by one
      stars.forEach((s, i) => {
        const earned = i < starsEarned;
        tl.add(() => {
          s.classList.toggle('on', earned);
          if (earned) {
            audio.star(i);
            const c = center(s);
            particles.burst(c.x, c.y, { count: 16, sprite: ['star', 'sparkGold'], speed: [200, 500], size: [14, 26], g: 700 });
            particles.ring(c.x, c.y, 90, '#fff6c8', 8);
            shake(0.25 + i * 0.12);
            punch(0.02);
          } else audio.click();
        });
        tl.fromTo(s, { scale: 3, rotation: -40, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.4, ease: earned ? 'back.out(3)' : 'power2.out' });
      });
      // score count up with coin ticks
      tl.add(() => {
        let n = 0;
        countTo(scoreV, 0, r.score, Math.min(1.8, 0.6 + r.score / 20000), formatNum, () => audio.coin(n++)).then(() => {
          pop(scoreV, 1.2);
          if (isBest) {
            audio.newBest();
            gsap.to(bestRibbon, { scale: 1, rotation: -6, duration: 0.6, ease: 'elastic.out(1.2,0.4)' });
            particles.confetti(140);
            for (let i = 0; i < 4; i++) gsap.delayedCall(i * 0.25, () => particles.firework(rand(innerWidth * 0.1, innerWidth * 0.9), rand(innerHeight * 0.1, innerHeight * 0.4), (['sparkGold', 'sparkRed', 'sparkCyan'] as const)[i % 3]));
            shake(0.6);
          } else if (starsEarned === 3) {
            particles.confetti(80);
          }
        });
      });
      gsap.from(missedList.children, { x: -40, opacity: 0, stagger: 0.05, delay: 1.4, duration: 0.4, ease: 'back.out(2)' });
    },
    leave() {
      offLang();
    },
    onKey(e) {
      if (e.key === 'Enter') retry.dispatchEvent(new PointerEvent('pointerdown')), retry.dispatchEvent(new PointerEvent('pointerup', { clientX: innerWidth / 2, clientY: innerHeight / 2 }));
    },
  };
}

