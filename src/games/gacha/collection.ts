/**
 * 图鉴 Collection: how many words you own overall, per level and per rarity, and a grid of
 * every word slot in a level. Missing slots keep a dim rarity edge, so you know what to hunt.
 */
import gsap from 'gsap';
import './vault.css';
import type { Screen } from '../../core/app';
import { app } from '../../core/app';
import { LEVELS, loadLevel, type Word } from '../../core/data';
import { h, formatNum } from '../../core/util';
import { t, tx, i18n } from '../../core/i18n';
import { store } from '../../core/store';
import { RARITIES, rarities, cardKey } from '../../core/rarity';
import { audio } from '../../engine/audio';
import { pop, pressable, nope, popIn } from '../../engine/juice';
import { langToggle, iconButton, ICON } from '../../ui/widgets';
import { ownedCount } from './gacha';
import { miniCard } from './mini';
import { openCardView } from './cardView';
import { toast } from './VaultScreen';

type Filter = 'all' | 'owned' | 'missing';
let lastLevel = 1;
let lastFilter: Filter = 'all';

const TOTAL = LEVELS.reduce((s, L) => s + L.count, 0);

export function ring(frac: number, size: number, stroke: number, color: string) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="${stroke}"/>
    <circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}" transform="rotate(-90 ${size / 2} ${size / 2})" style="--c:${c}"/>
  </svg>`;
}

export function create(): Screen {
  let level = lastLevel;
  let filter: Filter = lastFilter;
  let words: Word[] = [];
  let tiers: Int8Array = new Int8Array(0);

  const back = () => import('./VaultScreen').then((m) => m.create());
  const top = h(
    'div',
    { class: 'topbar' },
    iconButton(ICON.back, 'Back', (e) => back().then((s) => app.go(() => s, { x: e.clientX, y: e.clientY }))),
    h('div', { class: 'topbar-title' }, h('span', { class: 'game-chip', style: '--c:#b8741f' }, '图鉴 · ', tx('collection'))),
    langToggle(),
  );

  // ---- overview
  const owned = Object.keys(store.progress.cards).length;
  const byR = RARITIES.map(() => 0);
  for (const k in store.progress.cards) byR[store.progress.cards[k][1]]++;
  const hero = h(
    'div',
    { class: 'col-hero' },
    h('div', { class: 'col-ring', html: ring(owned / TOTAL, 96, 9, 'url(#gold)') }, h('span', { class: 'col-pct' }, `${((owned / TOTAL) * 100).toFixed(owned && owned < TOTAL / 100 ? 1 : 0)}%`)),
    h(
      'div',
      { class: 'col-hero-text' },
      h('span', { class: 'col-big' }, formatNum(owned), h('small', null, ` / ${formatNum(TOTAL)}`)),
      h('span', { class: 'col-k' }, tx('statWords')),
      h('div', { class: 'col-rar' }, ...RARITIES.slice().reverse().map((R) => h('span', { class: 'col-r', style: `--rc:${R.color}` }, h('i'), h('b', null, formatNum(byR[R.i])), R.name))),
    ),
  );
  // gold gradient for the ring stroke
  hero.querySelector('svg')!.insertAdjacentHTML('afterbegin', '<defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c0"/><stop offset=".5" stop-color="#f0bf45"/><stop offset="1" stop-color="#b47a1c"/></linearGradient></defs>');

  const tabs = LEVELS.map((L) => {
    const pct = h('small');
    const b = h('button', { class: 'col-tab', style: `--c:${L.color}`, 'data-n': String(L.n) }, h('b', null, `HSK${L.n}`), pct);
    pct.textContent = `${Math.floor((ownedCount(L.n) / L.count) * 100)}%`;
    pressable(b, () => {
      if (level === L.n) return;
      audio.pop(0.9 + L.n * 0.06);
      level = lastLevel = L.n;
      render(true);
    });
    return b;
  });
  const filters = (['all', 'owned', 'missing'] as Filter[]).map((f) => {
    const b = h('button', { class: 'col-filter', 'data-f': f }, tx(f));
    pressable(b, () => {
      if (filter === f) return;
      audio.pop(1);
      filter = lastFilter = f;
      render(false);
    });
    return b;
  });
  const levelLine = h('div', { class: 'col-line' });
  const grid = h('div', { class: 'col-grid' });
  const scroller = h('div', { class: 'col-scroll' }, hero, h('div', { class: 'col-tabs' }, ...tabs), h('div', { class: 'col-bar' }, levelLine, h('div', { class: 'col-filters' }, ...filters)), grid);
  const el = h('div', { class: 'screen collection' }, top, scroller);

  // tile taps via delegation (HSK 6 has 2,500 tiles)
  grid.addEventListener('click', (e) => {
    const tile = (e.target as HTMLElement).closest<HTMLElement>('.mc');
    if (!tile) return;
    const i = Number(tile.dataset.i);
    const w = words[i];
    const card = store.progress.cards[cardKey(level, w.h)];
    if (!card) {
      audio.tick(true);
      nope(tile);
      toast(t('notCollected'));
      return;
    }
    audio.pop(1.1);
    pop(tile, 0.6);
    openCardView({ word: w, level, no: i + 1, rarity: card[1], copies: card[0], first: card[2] });
  });

  let token = 0;
  const render = async (reload: boolean) => {
    const my = ++token;
    tabs.forEach((b) => b.classList.toggle('on', Number(b.dataset.n) === level));
    filters.forEach((b) => b.classList.toggle('on', b.dataset.f === filter));
    const L = LEVELS[level - 1];
    el.style.setProperty('--lc', L.color);
    const n = ownedCount(level);
    levelLine.replaceChildren(h('b', null, `HSK ${level}`), ` · ${formatNum(n)} / ${formatNum(L.count)} `, tx('collected'));
    if (reload || !words.length) {
      grid.replaceChildren(h('div', { class: 'col-loading' }, tx('loading')));
      try {
        words = await loadLevel(level);
      } catch {
        grid.replaceChildren(h('div', { class: 'col-loading' }, tx('loadFail')));
        return;
      }
      if (my !== token) return;
      tiers = rarities(level, words);
    }
    const frag = document.createDocumentFragment();
    const tiles: HTMLElement[] = [];
    words.forEach((w, i) => {
      const card = store.progress.cards[cardKey(level, w.h)];
      if ((filter === 'owned' && !card) || (filter === 'missing' && card)) return;
      const m = card ? miniCard(w, card[1], { no: i + 1, copies: card[0] }) : miniCard(null, tiers[i], { no: i + 1 });
      if (!card) m.dataset.r = String(tiers[i]);
      m.dataset.i = String(i);
      frag.append(m);
      tiles.push(m);
    });
    if (!tiles.length) frag.append(h('div', { class: 'col-loading' }, filter === 'owned' ? tx('notCollected') : tx('complete')));
    grid.replaceChildren(frag);
    popIn(tiles.slice(0, 30), 0, 0.012);
  };
  const offLang = i18n.onChange(() => render(false));

  return {
    el,
    theme: 'vault',
    enter() {
      render(true);
      gsap.from(hero, { y: -40, opacity: 0, duration: 0.6, ease: 'back.out(1.8)' });
      const fill = hero.querySelector<SVGCircleElement>('.ring-fill')!;
      const full = Number(fill.getAttribute('stroke-dasharray'));
      gsap.from(fill, { attr: { 'stroke-dashoffset': full }, duration: 1.4, delay: 0.2, ease: 'power3.out' });
      popIn(tabs, 0.1, 0.05);
    },
    leave() {
      offLang();
    },
    onKey(e) {
      const n = Number(e.key);
      if (n >= 1 && n <= 6) {
        level = lastLevel = n;
        render(true);
      }
      if (e.key === 'Escape') back().then((s) => app.go(() => s));
    },
  };
}
