import gsap from 'gsap';
import { h, center, formatNum } from '../core/util';
import { t, tx, i18n } from '../core/i18n';
import type { Screen } from '../core/app';
import { app } from '../core/app';
import { store } from '../core/store';
import { LEVELS, loadLevel } from '../core/data';
import { audio } from '../engine/audio';
import { particles } from '../engine/particles';
import { shake } from '../engine/shake';
import { pop, pressable, popIn, nope } from '../engine/juice';
import { langToggle, muteButton, iconButton, ICON } from '../ui/widgets';
import { bestKey, type GameDef, type Mode } from '../games/registry';
import { homeScreen } from './home';

let lastMode: Mode = 'rush';

export function levelsScreen(game: GameDef): Screen {
  let mode: Mode = lastMode;
  let loading = false;

  const title = h('h1', { class: 'screen-title' }, tx('chooseLevel'));
  const top = h(
    'div',
    { class: 'topbar' },
    iconButton(ICON.back, 'Back', (e) => app.go(homeScreen, { x: e.clientX, y: e.clientY })),
    h('div', { class: 'topbar-title' }, h('span', { class: 'game-chip', style: `--c:${game.color}` }, tx(game.name))),
    muteButton(),
    langToggle(),
  );

  // mode segmented control
  const seg = h('div', { class: 'seg' });
  const segKnob = h('span', { class: 'seg-knob' });
  const opts = (['rush', 'zen'] as Mode[]).map((m) =>
    h('button', { class: 'seg-opt', 'data-m': m },
      h('span', { class: 'seg-name' }, tx(m === 'rush' ? 'modeRush' : 'modeZen')),
      h('span', { class: 'seg-desc' }, tx(m === 'rush' ? 'modeRushDesc' : 'modeZenDesc'))),
  );
  seg.append(segKnob, ...opts);

  const bestLabels: HTMLElement[] = [];
  const syncMode = (animate: boolean) => {
    opts.forEach((o) => o.classList.toggle('on', o.dataset.m === mode));
    gsap.to(segKnob, { xPercent: mode === 'zen' ? 100 : 0, duration: animate ? 0.5 : 0, ease: 'elastic.out(1.1,0.55)' });
    bestLabels.forEach((b, i) => {
      const v = store.getBest(bestKey(game.id, LEVELS[i].n, mode));
      b.textContent = v ? formatNum(v) : '—';
    });
  };
  opts.forEach((o) =>
    pressable(o, () => {
      if (mode === o.dataset.m) return;
      mode = lastMode = o.dataset.m as Mode;
      audio.pop(mode === 'zen' ? 0.8 : 1.1);
      syncMode(true);
      pop(segKnob);
    }),
  );

  const buttons = LEVELS.map((L) => {
    const best = h('span', { class: 'lv-best-v' }, '—');
    bestLabels.push(best);
    const btn = h(
      'button',
      { class: 'level-btn', style: `--c:${L.color};--d:${L.dark}` },
      h('span', { class: 'lv-top' }, h('span', { class: 'lv-hsk' }, 'HSK'), h('span', { class: 'lv-n' }, String(L.n))),
      h('span', { class: 'lv-sample' }, L.sample),
      h('span', { class: 'lv-count' }, `${formatNum(L.count)} `, tx('words')),
      h('span', { class: 'lv-best', html: ICON.crown }, best),
    );
    pressable(btn, async (e) => {
      if (loading || !game.load) return;
      loading = true;
      audio.unlock();
      audio.pop(1 + L.n * 0.08);
      const c = center(btn);
      particles.burst(c.x, c.y, { count: 26, sprite: ['star', 'coin', 'yuanbao'], speed: [250, 650], size: [18, 30], g: 1100 });
      particles.ring(c.x, c.y, 130, '#fff', 10);
      shake(0.3);
      btn.classList.add('is-loading');
      try {
        const [words, mod] = await Promise.all([loadLevel(L.n), game.load()]);
        app.go(() => mod.create({ level: L.n, mode, words }), { x: e.clientX, y: e.clientY });
      } catch {
        btn.classList.remove('is-loading');
        loading = false;
        nope(btn);
        audio.wrong();
        toast(t('loadFail'));
      }
    });
    return btn;
  });

  const grid = h('div', { class: 'level-grid' }, ...buttons);
  const el = h('div', { class: 'screen levels' }, top, title, seg, grid);
  const offLang = i18n.onChange(() => syncMode(false));

  return {
    el,
    theme: 'home',
    enter() {
      syncMode(false);
      gsap.from(title, { scale: 0.3, opacity: 0, duration: 0.6, ease: 'elastic.out(1,0.5)' });
      gsap.from(seg, { y: 30, opacity: 0, duration: 0.5, delay: 0.1, ease: 'back.out(2)' });
      popIn(buttons, 0.15, 0.06);
      // prefetch the most likely level
      loadLevel(1).catch(() => {});
    },
    leave() {
      offLang();
    },
    onKey(e) {
      const n = Number(e.key);
      if (n >= 1 && n <= 6) buttons[n - 1].dispatchEvent(new PointerEvent('pointerdown')), buttons[n - 1].dispatchEvent(new PointerEvent('pointerup', { clientX: innerWidth / 2, clientY: innerHeight / 2 }));
      if (e.key === 'Escape') app.go(homeScreen);
    },
  };
}

function toast(msg: string) {
  const el = h('div', { class: 'toast' }, msg);
  document.getElementById('overlay')!.append(el);
  gsap.timeline({ onComplete: () => el.remove() })
    .from(el, { y: 60, opacity: 0, duration: 0.4, ease: 'back.out(2)' })
    .to(el, { y: -20, opacity: 0, duration: 0.3, delay: 2.2 });
}
