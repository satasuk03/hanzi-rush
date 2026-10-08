/** Leaderboard: mode segment, HSK level pills, all-time / week / day tabs, top N, pinned "me" row. */
import gsap from 'gsap';
import { h, formatNum } from '../core/util';
import { t, tx, i18n } from '../core/i18n';
import type { Screen } from '../core/app';
import { app } from '../core/app';
import { LEVELS } from '../core/data';
import { titleById } from '../core/meta';
import { cloud } from '../core/cloud';
import { applyNameFx, renderBadges, renderIdentity } from '../cosmetics/render';
import { audio } from '../engine/audio';
import { pop, pressable, popIn } from '../engine/juice';
import { langToggle, muteButton, iconButton, ICON } from '../ui/widgets';
import { GAMES } from '../games/registry';
import { boardKey, parseBoardKey, PERIODS, type BoardEntry, type BoardResponse, type Mode, type Period, type RankedGame } from '../../shared/api';
import { showPlayerCard } from '../ui/playerCard';
import { homeScreen } from './home';
import { levelsScreen } from './levels';

const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; data: BoardResponse }>();
/** no account on this device (cloud save off / signed out): boards are read anonymously, with no "me" row */
const anonymous = () => cloud.status === 'disabled' || cloud.status === 'signedOut';
// the account behind a cached board changed (deleted, signed out, restored): "me" rows in the cache are stale
cloud.on('status', () => {
  const k = anonymous() ? 'anon' : 'acct';
  if (k !== lastKind) cache.clear();
  lastKind = k;
});
let lastKind = anonymous() ? 'anon' : 'acct';

/** drop every cached period of a board (a run was just accepted there) */
export function invalidateBoard(board: string) {
  for (const k of cache.keys()) if (k.startsWith(`${board}|`)) cache.delete(k);
}

const PERIOD_KEY = { all: 'lbAll', week: 'lbWeek', day: 'lbDay' } as const;

/** "5h 12m" / "42m" / "2d 3h" until the period rolls over */
function untilReset(at: number) {
  const m = Math.max(1, Math.round((at - Date.now()) / 60_000));
  const d = Math.floor(m / 1440);
  const hr = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m % 60}m` : `${m}m`;
}

export function leaderboardScreen(opts: { board: ReturnType<typeof boardKey>; period?: Period; from: 'levels' | 'results' }): Screen {
  const parsed = parseBoardKey(opts.board)!;
  const game = GAMES.find((g) => g.id === parsed.game)!;
  let level = parsed.level;
  let mode: Mode = parsed.mode;
  let period: Period = opts.period ?? 'all';
  let seq = 0;
  let data: BoardResponse | null = null;
  let state: 'loading' | 'ok' | 'offline' = 'loading';

  const goBack = (e?: { clientX: number; clientY: number }) => {
    const from = e ? { x: e.clientX, y: e.clientY } : undefined;
    app.go(opts.from === 'levels' ? () => levelsScreen(game) : homeScreen, from);
  };

  const top = h(
    'div',
    { class: 'topbar' },
    iconButton(ICON.back, 'Back', (e) => goBack(e)),
    h('div', { class: 'topbar-title' }, h('span', { class: 'game-chip', style: `--c:${game.color}` }, tx(game.name))),
    muteButton(),
    langToggle(),
  );
  const title = h('h1', { class: 'screen-title lb-title' }, tx('leaderboard'));

  // mode segment (same look as the level screen)
  const seg = h('div', { class: 'seg lb-seg' });
  const segKnob = h('span', { class: 'seg-knob' });
  const modeOpts = (['rush', 'zen'] as Mode[]).map((m) => h('button', { class: 'seg-opt', 'data-m': m }, h('span', { class: 'seg-name' }, tx(m === 'rush' ? 'modeRush' : 'modeZen'))));
  seg.append(segKnob, ...modeOpts);

  const pills = LEVELS.map((L) => {
    const b = h('button', { class: 'lb-lv', style: `--c:${L.color};--d:${L.dark}`, 'data-n': String(L.n) }, String(L.n));
    pressable(b, () => {
      if (level === L.n) return;
      level = L.n;
      audio.pop(1 + L.n * 0.08);
      sync();
      load();
    });
    return b;
  });
  const levelsRow = h('div', { class: 'lb-levels' }, h('span', { class: 'lb-hsk' }, 'HSK'), ...pills);

  const tabs = PERIODS.map((p) => {
    const b = h('button', { class: 'lb-tab', 'data-p': p }, tx(PERIOD_KEY[p]));
    pressable(b, () => {
      if (period === p) return;
      period = p;
      audio.pop(1.1);
      sync();
      load();
    });
    return b;
  });
  const resets = h('div', { class: 'lb-resets' });
  const list = h('div', { class: 'lb-list' });
  const meRow = h('div', { class: 'lb-foot' });
  const panel = h('div', { class: 'lb-panel' }, h('div', { class: 'lb-tabs' }, ...tabs), resets, list, meRow);

  modeOpts.forEach((o) =>
    pressable(o, () => {
      if (mode === o.dataset.m) return;
      mode = o.dataset.m as Mode;
      audio.pop(mode === 'zen' ? 0.8 : 1.1);
      sync();
      pop(segKnob);
      load();
    }),
  );

  const curBoard = () => boardKey(game.id as RankedGame, level, mode);
  const sync = (animate = true) => {
    modeOpts.forEach((o) => o.classList.toggle('on', o.dataset.m === mode));
    gsap.to(segKnob, { xPercent: mode === 'zen' ? 100 : 0, duration: animate ? 0.5 : 0, ease: 'elastic.out(1.1,0.55)' });
    pills.forEach((b) => b.classList.toggle('on', Number(b.dataset.n) === level));
    tabs.forEach((b) => b.classList.toggle('on', b.dataset.p === period));
  };

  const rowFor = (e: BoardEntry, pinned = false) => {
    const T = titleById(e.title);
    const medal = e.rank <= 3 ? ` m${e.rank}` : '';
    const nm = h('span', { class: 'lb-nm' }, e.name || `${t('playerName')}#${e.tag}`);
    applyNameFx(nm, e.look, e.rank <= 10 || e.isMe);
    const row = h(
      'div',
      { class: `lb-row${e.isMe ? ' me' : ''}${medal}${pinned ? ' pinned' : ''}` },
      h('span', { class: 'lb-rank' }, e.rank <= 99999 ? String(e.rank) : '99k+'),
      renderIdentity(e.look, 'S', { title: T }),
      h('span', { class: 'lb-who' }, h('span', { class: 'lb-name' }, nm, renderBadges(e.look, 'S'), e.isMe ? h('em', null, '\u00a0', tx('lbYou')) : null), h('span', { class: 'lb-title-t' }, T[i18n.lang])),
      h('span', { class: 'lb-score' }, formatNum(e.score), e.verified ? null : h('span', { class: 'lb-unv', title: t('lbUnverified'), 'aria-label': t('lbUnverified') }, '?')),
    );
    // rows from a server that predates cards carry no pid and are not tappable
    const pid = e.pid;
    if (pid) {
      row.classList.add('tap');
      row.setAttribute('role', 'button');
      row.addEventListener('click', () => {
        audio.pop(1.1);
        const g = `HSK ${level} ${t(mode === 'rush' ? 'modeRush' : 'modeZen')}`;
        showPlayerCard({ pid, name: e.name, tag: e.tag, title: e.title, look: e.look, isMe: e.isMe, context: `#${e.rank} · ${g} · ${formatNum(e.score)}` });
      });
    }
    return row;
  };

  const render = (animate: boolean) => {
    list.replaceChildren();
    meRow.replaceChildren();
    resets.textContent = '';
    if (state === 'loading') {
      list.append(h('p', { class: 'lb-msg' }, tx('loading')));
      return;
    }
    if (state === 'offline' || !data) {
      const b = h('button', { class: 'lb-msg lb-retry' }, tx('lbOffline'));
      pressable(b, () => load(true));
      list.append(b);
      return;
    }
    if (data.resetsAt) resets.append(`${t('lbResets')} ${untilReset(data.resetsAt)}`);
    if (!data.entries.length) list.append(h('p', { class: 'lb-msg' }, tx('lbEmpty')));
    const rows = data.entries.map((e) => rowFor(e));
    list.append(...rows);
    if (data.me && !data.entries.some((e) => e.isMe)) meRow.append(rowFor(data.me, true));
    else if (!data.me && !anonymous()) meRow.append(h('p', { class: 'lb-hint' }, tx('lbUnranked')));
    if (animate && rows.length) popIn(rows, 0.1, 0.03);
  };

  /** 30 s in-memory cache per (board, period); `force` bypasses it (retry button) */
  async function load(force = false) {
    const key = `${curBoard()}|${period}`;
    const hit = cache.get(key);
    const my = ++seq;
    if (hit && !force && Date.now() - hit.at < CACHE_MS) {
      data = hit.data;
      state = 'ok';
      return render(true);
    }
    state = 'loading';
    render(false);
    try {
      const res = await cloud.board(curBoard(), period);
      if (my !== seq) return;
      cache.set(key, { at: Date.now(), data: res });
      data = res;
      state = 'ok';
    } catch {
      if (my !== seq) return;
      state = 'offline';
    }
    render(true);
  }

  const el = h('div', { class: 'screen leaderboard' }, top, title, seg, levelsRow, panel);
  const offLang = i18n.onChange(() => render(false));

  return {
    el,
    theme: 'results',
    enter() {
      sync(false);
      gsap.from(title, { scale: 0.3, opacity: 0, duration: 0.6, ease: 'elastic.out(1,0.5)' });
      gsap.from([seg, levelsRow], { y: 30, opacity: 0, duration: 0.5, delay: 0.1, stagger: 0.06, ease: 'back.out(2)' });
      gsap.from(panel, { y: 60, opacity: 0, duration: 0.6, delay: 0.2, ease: 'back.out(1.5)' });
      load();
    },
    leave() {
      seq++;
      offLang();
    },
    onKey(e) {
      if (e.key === 'Escape') goBack();
    },
  };
}
