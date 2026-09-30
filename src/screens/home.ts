import gsap from 'gsap';
import { h, center, pick, rand } from '../core/util';
import { tx } from '../core/i18n';
import type { Screen } from '../core/app';
import { app } from '../core/app';
import { audio, speak } from '../engine/audio';
import { particles } from '../engine/particles';
import { shake } from '../engine/shake';
import { pop, pressable, dropIn, popIn, loop, breathe, bob, nope } from '../engine/juice';
import { langToggle, muteButton, ICON } from '../ui/widgets';
import { store } from '../core/store';
import { formatNum } from '../core/util';
import { playerLevel, titleById } from '../core/meta';
import { i18n } from '../core/i18n';
import { mascot, setMood } from '../ui/mascot';
import { GAMES } from '../games/registry';
import { levelsScreen } from './levels';

export function logo() {
  const tiles = ['汉', '字'].map((c, i) => h('span', { class: `logo-tile t${i}` }, c));
  const letters = [...'RUSH'].map((c) => h('span', { class: 'logo-letter' }, c));
  const el = h('div', { class: 'logo' }, h('div', { class: 'logo-tiles' }, ...tiles), h('div', { class: 'logo-rush' }, ...letters));
  return { el, tiles, letters };
}

export function homeScreen(): Screen {
  const lg = logo();
  const buddy = mascot('happy');
  const [feat, ...rest] = GAMES;

  const playBtn = h('span', { class: 'play-pill' }, tx('play'), h('span', { class: 'play-arrow' }, '▶'));
  const featured = h(
    'button',
    { class: 'game-card featured', style: `--c:${feat.color};--d:${feat.dark}` },
    h('span', { class: 'gc-glyph' }, feat.glyph),
    h('span', { class: 'gc-text' }, h('span', { class: 'gc-name' }, tx(feat.name)), feat.desc ? h('span', { class: 'gc-desc' }, tx(feat.desc)) : null),
    playBtn,
  );
  const openGame = (e: PointerEvent) => {
    audio.unlock();
    audio.startMusic();
    audio.pop(1.3);
    const c = center(featured);
    particles.burst(c.x, c.y, { count: 22, sprite: ['star', 'coin'], speed: [250, 600], size: [16, 28], g: 1000 });
    shake(0.25);
    app.go(() => levelsScreen(feat), { x: e.clientX, y: e.clientY });
  };
  pressable(featured, openGame);

  const locked = rest.map((g) => {
    const card = h(
      'button',
      { class: 'game-card locked', style: `--c:${g.color};--d:${g.dark}` },
      h('span', { class: 'gc-glyph' }, g.glyph),
      h('span', { class: 'gc-name' }, tx(g.name)),
      h('span', { class: 'gc-soon' }, h('span', { class: 'lock', html: ICON.lock }), tx('comingSoon')),
    );
    pressable(card, () => {
      audio.unlock();
      audio.tick(true);
      nope(card);
    });
    return card;
  });

  // vault (gacha) — its own lazy chunk
  const vaultPill = h('span', { class: 'play-pill gold' }, tx('open'), h('span', { class: 'play-arrow' }, '✦'));
  const vault = h(
    'button',
    { class: 'game-card featured vault-card' },
    h('span', { class: 'vc-shine' }),
    h('span', { class: 'gc-glyph vc-glyph' }, '宝'),
    h('span', { class: 'gc-text' }, h('span', { class: 'gc-name' }, tx('vaultName')), h('span', { class: 'gc-desc' }, tx('vaultDesc'))),
    vaultPill,
    h('span', { class: 'vc-new' }, 'NEW'),
  );
  const openVault = (e: PointerEvent) => {
    audio.unlock();
    audio.startMusic();
    audio.pop(1.4);
    const c = center(vault);
    particles.burst(c.x, c.y, { count: 22, sprite: ['sparkGold', 'goldLeaf', 'coin'], speed: [250, 600], size: [14, 26], g: 700 });
    shake(0.25);
    import('../games/gacha/VaultScreen').then((m) => app.go(() => m.create(), { x: e.clientX, y: e.clientY }));
  };
  pressable(vault, openVault);

  // profile chip: title seal + level + coins
  const lv = playerLevel();
  const T = titleById(store.progress.profile.title);
  const chipName = h('span', { class: 'pc-name' });
  const syncChip = () => (chipName.textContent = store.progress.profile.name || T[i18n.lang]);
  syncChip();
  const chip = h(
    'button',
    { class: 'profile-chip', 'aria-label': 'Profile' },
    h('span', { class: 'pc-seal', 'data-t': String(T.tier) }, T.zh[0], h('span', { class: 'pc-lv' }, String(lv.level))),
    h('span', { class: 'pc-text' }, chipName, h('span', { class: 'pc-coins' }, h('span', { class: 'mini-coin', html: ICON.coin }), formatNum(store.progress.coins))),
    h('span', { class: 'pc-xp' }, h('span', { style: `transform:scaleX(${lv.into / lv.need})` })),
  );
  pressable(chip, (e) => {
    audio.unlock();
    audio.pop(1.2);
    import('../games/gacha/profile').then((m) => app.go(() => m.create('home'), { x: e.clientX, y: e.clientY }));
  });
  const offLang = i18n.onChange(syncChip);

  const top = h('div', { class: 'topbar' }, chip, h('div', { class: 'spacer' }), muteButton(), langToggle());
  const tagline = h('p', { class: 'tagline' }, tx('tagline'));
  const el = h(
    'div',
    { class: 'screen home' },
    top,
    h('div', { class: 'home-hero' }, lg.el, tagline, buddy),
    h('div', { class: 'home-games' }, featured, vault, h('div', { class: 'locked-grid' }, ...locked)),
  );

  const greetings = ['你好!', '加油!', '欢迎!', '太棒了!'];
  pressable(buddy, () => {
    audio.unlock();
    audio.pop(1.4);
    setMood(buddy, 'wow');
    const c = center(buddy);
    particles.treasure(c.x, c.y, () => center(featured), 10, (i) => audio.coin(i), () => pop(featured, 0.6));
    particles.ring(c.x, c.y, 120, '#fff', 10);
    shake(0.3);
    speak(pick(greetings), true);
    gsap.delayedCall(0.9, () => setMood(buddy, 'happy'));
  });

  let sparkleT = 0;
  return {
    el,
    theme: 'home',
    enter() {
      lg.letters.forEach((l, i) => dropIn(l, 0.15 + i * 0.08, -160));
      popIn(lg.tiles, 0, 0.12);
      gsap.from(tagline, { opacity: 0, y: 16, delay: 0.6, duration: 0.5, ease: 'back.out(2)' });
      gsap.from(buddy, { scale: 0, delay: 0.35, duration: 0.8, ease: 'elastic.out(1,0.45)' });
      gsap.from(featured, { y: 80, opacity: 0, delay: 0.4, duration: 0.7, ease: 'back.out(1.6)' });
      gsap.from(vault, { y: 80, opacity: 0, delay: 0.5, duration: 0.7, ease: 'back.out(1.6)' });
      gsap.from(chip, { x: -60, opacity: 0, delay: 0.2, duration: 0.6, ease: 'back.out(2)' });
      popIn(locked, 0.6, 0.07);
      gsap.delayedCall(0.3, () => audio.drum(0, 0.4));
      // idle loops — registered so leaving the screen resets them cleanly
      lg.tiles.forEach((t, i) => loop(`home:tile${i}`, t, () => gsap.to(t, { y: -6, rotation: i ? 8 : -8, duration: 1.2 + i * 0.2, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: i * 0.3 }), { y: 0, rotation: i ? 6 : -6 }));
      loop('home:buddy', buddy, () => bob(buddy, 10, 1.3), { y: 0 });
      loop('home:play', playBtn, () => breathe(playBtn, 0.06, 0.55), { scaleX: 1, scaleY: 1 });
      loop('home:vault', vaultPill, () => breathe(vaultPill, 0.05, 0.7), { scaleX: 1, scaleY: 1 });
    },
    leave() {
      offLang();
    },
    update(dt) {
      sparkleT -= dt;
      if (sparkleT <= 0) {
        sparkleT = rand(0.25, 0.6);
        const r = lg.el.getBoundingClientRect();
        particles.burst(rand(r.left, r.right), rand(r.top, r.bottom), { count: 3, sprite: 'spark', speed: [20, 80], size: [14, 26], g: -30, life: [0.5, 0.9], add: true });
      }
    },
    onKey(e) {
      if (e.key === 'Enter') openGame(new PointerEvent('pointerup', { clientX: innerWidth / 2, clientY: innerHeight / 2 }));
    },
  };
}
