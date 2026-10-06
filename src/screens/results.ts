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
import { langToggle, muteButton, iconButton, bigButton, ICON } from '../ui/widgets';
import { mascot } from '../ui/mascot';
import { GAMES, bestKey, type Mode } from '../games/registry';
import { homeScreen } from './home';
import type { Reward } from '../core/meta';
import { t } from '../core/i18n';
import { notify } from '../ui/notify';
import { levelsScreen } from './levels';
import { cloud } from '../core/cloud';
import { boardKey, RANKED_GAMES, type RankedGame, type SubmitRunResponse } from '../../shared/api';
import { invalidateBoard, leaderboardScreen } from './leaderboard';
import { invalidateEffort } from './effort';
import { nameAsked, showNamePrompt } from '../ui/transfer';

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
  /** coins + XP paid out for this run */
  reward?: Reward;
  /** cloud run id (clientRunId) and wall clock of the run, for leaderboard submission */
  runId?: string;
  durationMs?: number;
}

const STAR_SVG = `<svg viewBox="0 0 100 100"><path d="M50 6l13 28 30 4-22 21 6 30-27-15-27 15 6-30L7 38l30-4z" fill="currentColor" stroke="#2a1a3a" stroke-width="7" stroke-linejoin="round"/><ellipse cx="38" cy="36" rx="7" ry="4" fill="#fff" opacity=".7" transform="rotate(-35 38 36)"/></svg>`;

export function resultsScreen(r: RunStats): Screen {
  const game = GAMES.find((g) => g.id === r.game)!;
  const acc = r.asked ? r.correct / r.asked : 0;
  const starsEarned = r.correct === 0 ? 0 : acc >= 0.95 ? 3 : acc >= 0.8 ? 2 : acc >= 0.5 ? 1 : 0;
  const key = bestKey(r.game, r.level, r.mode);
  const prevBest = store.getBest(key);
  const isBest = r.score > 0 && store.submitBest(key, r.score);
  const ranked = (RANKED_GAMES as readonly string[]).includes(r.game);
  const board = ranked ? boardKey(r.game as RankedGame, r.level, r.mode) : null;

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

  // ---- leaderboard: submit in the background, show the rank when (if) the server answers
  let alive = true;
  const showRank = (res: SubmitRunResponse | null) => {
    if (!res || !alive) return;
    const all = res.ranks.all;
    const day = res.ranks.day;
    const pick = all.improved && all.rank ? { n: all.rank, k: 'lbRankAll' as const } : day.rank ? { n: day.rank, k: 'lbRankDay' as const } : null;
    if (!pick) return;
    const chip = h('div', { class: 'r-rank' }, h('span', { class: 'r-rank-ic', html: ICON.trophy }), h('b', null, `#${formatNum(pick.n)}`), tx(pick.k), res.verified ? null : h('small', { class: 'r-rank-un' }, tx('lbUnverified')));
    panel.insertBefore(chip, panel.querySelector('.r-stats'));
    gsap.from(chip, { scale: 0, duration: 0.6, ease: 'elastic.out(1.1,0.45)' });
    audio.pop(1.3);
    // first ranked run and no name yet: offer one (never blocks the screen; "Later" is final)
    if (!store.progress.profile.name && !nameAsked()) {
      setTimeout(() => {
        if (!alive || !board) return;
        showNamePrompt(() => {
          invalidateBoard(board);
          void cloud.flush().then(() => invalidateBoard(board));
        });
      }, 900);
    }
  };
  if (r.score > 0 && board) {
    const handle = cloud.handle(r.runId) ?? { id: r.runId ?? crypto.randomUUID(), board, startedAt: performance.now() - (r.durationMs ?? 0) };
    cloud
      .submitRun(handle, r)
      .then((res) => {
        if (res) {
          invalidateBoard(board);
          invalidateEffort();
        }
        showRank(res);
      })
      .catch(() => {});
    cloud.flush(); // progress (coins, xp, best) was just saved: push it too
  }

  // ---- rewards: coins + XP bar (+ level up)
  const rw = r.reward;
  const coinsV = h('span', { class: 'rw-v' }, '+0');
  const xpV = h('span', { class: 'rw-v' }, '+0');
  const lvV = h('span', { class: 'rw-lv' }, `Lv ${rw?.before.level ?? 1}`);
  const xpFill = h('span', { class: 'rw-fill' });
  const rewards = rw
    ? h(
        'div',
        { class: 'r-rewards' },
        h('div', { class: 'rw-row' },
          h('span', { class: 'rw-item' }, h('span', { class: 'rw-ic', html: ICON.coin }), coinsV),
          h('span', { class: 'rw-item xp' }, h('span', { class: 'rw-ic xp' }, 'XP'), xpV)),
        h('div', { class: 'rw-bar-row' }, lvV, h('span', { class: 'rw-bar' }, xpFill)),
      )
    : null;
  if (rewards) panel.insertBefore(rewards, missedList);

  const payout = () => {
    if (!rw || !rewards) return;
    let k = 0;
    countTo(coinsV, 0, rw.coins, 0.8, (n) => `+${formatNum(n)}`, () => audio.coin(k++));
    countTo(xpV, 0, rw.xp, 0.8, (n) => `+${formatNum(n)}`);
    const c = center(rewards);
    particles.burst(c.x, c.y, { count: 14, sprite: ['coin', 'sparkGold'], speed: [150, 420], size: [14, 24], g: 800 });
    gsap.set(xpFill, { scaleX: rw.before.into / rw.before.need });
    const ups = rw.after.level - rw.before.level;
    const tl = gsap.timeline({ delay: 0.2 });
    for (let i = 0; i < ups; i++) {
      tl.to(xpFill, { scaleX: 1, duration: 0.5, ease: 'power2.in' });
      tl.add(() => {
        const lv = rw.before.level + i + 1;
        lvV.textContent = `Lv ${lv}`;
        pop(lvV, 1.4);
        audio.newBest();
        const b = center(lvV);
        particles.firework(b.x, b.y, 'sparkGold');
        shake(0.4);
        const banner = h('div', { class: 'lvup' }, h('span', { class: 'lvup-k' }, t('levelUp')), h('span', { class: 'lvup-n' }, `Lv ${lv}`));
        document.getElementById('overlay')!.append(banner);
        gsap.timeline({ onComplete: () => banner.remove() })
          .fromTo(banner, { scale: 0, rotation: -12 }, { scale: 1, rotation: -3, duration: 0.6, ease: 'elastic.out(1.1,0.45)' })
          .to(banner, { y: -40, opacity: 0, duration: 0.35, delay: 0.8 });
      });
      tl.set(xpFill, { scaleX: 0 });
    }
    tl.to(xpFill, { scaleX: rw.after.into / rw.after.need, duration: 0.6, ease: 'power2.out' });
    rw.titles.forEach((T, i) => notify({ kicker: t('titleUnlocked'), title: `${T.zh} · ${T[i18n.lang]}`, seal: T.zh[0], tier: T.tier }, 1 + ups * 0.9 + i * 0.5));
  };

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
    h('div', { class: 'topbar' }, h('div', { class: 'spacer' }), cloud.status === 'off' || !board ? null : iconButton(ICON.trophy, 'Leaderboard', (e) => app.go(() => leaderboardScreen({ board, from: 'results' }), { x: e.clientX, y: e.clientY })), muteButton(), langToggle()),
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
          payout();
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
      alive = false;
      offLang();
    },
    onKey(e) {
      if (document.querySelector('.name-prompt')) return; // typing a name: Enter/Space belong to the prompt
      if (e.key === 'Escape') app.go(homeScreen);
      if (e.key === 'Enter') retry.dispatchEvent(new PointerEvent('pointerdown')), retry.dispatchEvent(new PointerEvent('pointerup', { clientX: innerWidth / 2, clientY: innerHeight / 2 }));
    },
  };
}

