/** Player card modal: opens at once with what a board row knows, fills the stats when GET /players/:pid/card answers. */
import gsap from 'gsap';
import './playerCard.css';
import { h, formatNum } from '../core/util';
import { t, tx, i18n, type Key } from '../core/i18n';
import { app } from '../core/app';
import { cloud } from '../core/cloud';
import { ApiError } from '../core/api';
import { titleById } from '../core/meta';
import { applyNameFx, renderBadges, renderIdentity } from '../cosmetics/render';
import { audio } from '../engine/audio';
import { pressable } from '../engine/juice';
import { TITLE_DEFS } from '../../shared/titles';
import type { Look, PlayerCardResponse } from '../../shared/api';

/** what a board row already knows */
export interface CardRow {
  pid: string;
  name: string;
  tag: string;
  title: string;
  look?: Look;
  isMe: boolean;
  /** "#3 · HSK 3 Rush · 12,300" */
  context: string;
}

const CACHE_MS = 60_000;
type Hit = { at: number; card: PlayerCardResponse | 'hidden' };
const cache = new Map<string, Hit>();
// the account behind a cached card may have changed its flag or look
cloud.on('status', () => cache.clear());

/** 'hidden' = 404 (unknown, banned or "card off"); throws when the request failed */
async function fetchCard(pid: string): Promise<PlayerCardResponse | 'hidden'> {
  const hit = cache.get(pid);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.card;
  let card: PlayerCardResponse | 'hidden';
  try {
    card = await cloud.playerCard(pid);
  } catch (e) {
    if (!(e instanceof ApiError) || e.code !== 'not_found') throw e;
    card = 'hidden';
  }
  cache.set(pid, { at: Date.now(), card });
  return card;
}

/** the player changed "Show my card" or their look: forget what we know about ourselves */
export const invalidatePlayerCards = () => cache.clear();

const overlay = () => document.getElementById('overlay')!;

export function showPlayerCard(row: CardRow) {
  const T = titleById(row.title);
  const nm = h('span', { class: 'pcm-nm' }, row.name || `${t('playerName')}#${row.tag}`);
  applyNameFx(nm, row.look, true);
  const lv = h('span', { class: 'pcm-lv' });
  const av = h('div', { class: 'pcm-av' }, renderIdentity(row.look, 'L', { title: T }), lv);
  const body = h('div', { class: 'pcm-body' });
  const x = h('button', { class: 'pcm-x', 'aria-label': t('pcClose') }, '×');
  const card = h(
    'div',
    { class: 'modal-card pcm' },
    x,
    av,
    h('div', { class: 'pcm-name' }, nm, renderBadges(row.look, 'L')),
    h('div', { class: 'pcm-title' }, `${T.zh} · ${T[i18n.lang]}`),
    h('div', { class: 'pcm-ctx' }, row.context),
    body,
  );
  if (row.isMe) {
    const b = h('button', { class: 'tf-btn green pcm-btn' }, tx('wdCustomize'));
    pressable(b, (e) => {
      audio.pop(1.2);
      close();
      import('../games/gacha/wardrobe').then((m) => app.go(() => m.create('home'), { x: e.clientX, y: e.clientY }));
    });
    card.append(b);
  }
  const el = h('div', { class: 'modal' }, card);
  overlay().append(el);
  gsap.from(el, { opacity: 0, duration: 0.2 });
  gsap.from(card, { scale: 0.7, y: 40, duration: 0.45, ease: 'back.out(1.8)' });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    removeEventListener('keydown', onKey, true);
    gsap.to(el, { opacity: 0, duration: 0.15, onComplete: () => el.remove() });
  }
  // capture + stop, so Escape (and hardware back, see app.back) closes the card and not the screen underneath
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.stopImmediatePropagation();
    close();
  }
  addEventListener('keydown', onKey, true);
  x.addEventListener('click', close);
  el.addEventListener('click', (e) => e.target === el && close());

  const stat = (k: Key, v: string) => h('div', { class: 'pcm-st' }, h('b', null, v), h('span', null, t(k)));
  const keys: Key[] = ['statWords', 'statGames', 'accuracy', 'maxCombo', 'pcStreak', 'pcTitles'];
  const skeleton = () => h('div', { class: 'pcm-stats pcm-sk' }, ...keys.map((k) => stat(k, '')));
  const message = (k: Key) => h('p', { class: 'pcm-msg' }, t(k));
  body.append(skeleton());

  fetchCard(row.pid).then(
    (res) => {
      if (closed) return;
      if (res === 'hidden') return body.replaceChildren(message(row.isMe ? 'pcOwnHidden' : 'pcPrivate'));
      const c = res.card;
      if (!c) return body.replaceChildren(message('pcNoStats')); // no save since cards shipped
      lv.textContent = `Lv${c.level}`;
      body.replaceChildren(
        h(
          'div',
          { class: 'pcm-stats' },
          stat('statWords', formatNum(c.words)),
          stat('statGames', formatNum(c.games)),
          stat('accuracy', c.questions ? `${Math.round((c.correct / c.questions) * 100)}%` : '—'),
          stat('maxCombo', `×${c.bestCombo}`),
          stat('pcStreak', formatNum(c.bestStreak)),
          stat('pcTitles', `${c.titles} / ${TITLE_DEFS.length}`),
        ),
      );
    },
    () => !closed && body.replaceChildren(message('pcStats')),
  );
}
