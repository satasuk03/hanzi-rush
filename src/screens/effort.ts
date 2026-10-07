/** Effort ("Dedication") leaderboard: who answered the most questions correctly. All-time / week / day tabs. */
import gsap from 'gsap';
import { h, formatNum } from '../core/util';
import { t, tx, i18n } from '../core/i18n';
import type { Screen } from '../core/app';
import { app } from '../core/app';
import { titleById } from '../core/meta';
import { cloud } from '../core/cloud';
import { applyNameFx, renderBadges, renderIdentity } from '../cosmetics/render';
import { audio } from '../engine/audio';
import { pressable, popIn } from '../engine/juice';
import { langToggle, muteButton, iconButton, ICON } from '../ui/widgets';
import { PERIODS, type EffortEntry, type EffortResponse, type Period } from '../../shared/api';
import { homeScreen } from './home';

const CACHE_MS = 30_000;
const cache = new Map<Period, { at: number; data: EffortResponse }>();
const PERIOD_KEY = { all: 'lbAll', week: 'lbWeek', day: 'lbDay' } as const;

/** drop every cached period (a run was just accepted, or the account behind the cache changed) */
export function invalidateEffort() {
  cache.clear();
}
cloud.on('status', invalidateEffort);

/** cached fetch shared by the screen and the home card */
export async function loadEffort(period: Period, limit: number, force = false): Promise<EffortResponse> {
  const hit = cache.get(period);
  if (hit && !force && Date.now() - hit.at < CACHE_MS && hit.data.entries.length >= Math.min(limit, hit.data.total)) return hit.data;
  const data = await cloud.effort(period, limit);
  cache.set(period, { at: Date.now(), data });
  return data;
}

function untilReset(at: number) {
  const m = Math.max(1, Math.round((at - Date.now()) / 60_000));
  const d = Math.floor(m / 1440);
  const hr = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m % 60}m` : `${m}m`;
}

export function effortScreen(opts: { period?: Period } = {}): Screen {
  let period: Period = opts.period ?? 'week';
  let seq = 0;
  let data: EffortResponse | null = null;
  let state: 'loading' | 'ok' | 'offline' = 'loading';
  const anonymous = () => cloud.status === 'disabled' || cloud.status === 'signedOut';

  const top = h(
    'div',
    { class: 'topbar' },
    iconButton(ICON.back, 'Back', (e) => app.go(homeScreen, { x: e.clientX, y: e.clientY })),
    h('div', { class: 'spacer' }),
    muteButton(),
    langToggle(),
  );
  const title = h('h1', { class: 'screen-title lb-title' }, tx('effortTitle'));
  const sub = h('p', { class: 'lb-resets' }, tx('effortSub'));

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

  const sync = () => tabs.forEach((b) => b.classList.toggle('on', b.dataset.p === period));

  const rowFor = (e: EffortEntry, pinned = false) => {
    const T = titleById(e.title);
    const medal = e.rank <= 3 ? ` m${e.rank}` : '';
    const nm = h('span', { class: 'lb-nm' }, e.name || `${t('playerName')}#${e.tag}`);
    applyNameFx(nm, e.look, e.rank <= 10 || e.isMe);
    return h(
      'div',
      { class: `lb-row${e.isMe ? ' me' : ''}${medal}${pinned ? ' pinned' : ''}` },
      h('span', { class: 'lb-rank' }, e.rank <= 99999 ? String(e.rank) : '99k+'),
      renderIdentity(e.look, 'S', { title: T }),
      h('span', { class: 'lb-who' }, h('span', { class: 'lb-name' }, nm, renderBadges(e.look, 'S'), e.isMe ? h('em', null, ' ', tx('lbYou')) : null), h('span', { class: 'lb-title-t' }, `${formatNum(e.runs)} ${t('effortRuns')}`)),
      h('span', { class: 'lb-score' }, formatNum(e.correct)),
    );
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
    if (!data.entries.length) list.append(h('p', { class: 'lb-msg' }, tx('effortEmpty')));
    const rows = data.entries.map((e) => rowFor(e));
    list.append(...rows);
    if (data.me && !data.entries.some((e) => e.isMe)) meRow.append(rowFor(data.me, true));
    else if (!data.me && !anonymous()) meRow.append(h('p', { class: 'lb-hint' }, tx('effortJoin')));
    if (animate && rows.length) popIn(rows, 0.1, 0.03);
  };

  async function load(force = false) {
    const my = ++seq;
    state = 'loading';
    if (force || !cache.has(period)) render(false);
    try {
      const res = await loadEffort(period, 50, force);
      if (my !== seq) return;
      data = res;
      state = 'ok';
    } catch {
      if (my !== seq) return;
      state = 'offline';
    }
    render(true);
  }

  const el = h('div', { class: 'screen leaderboard' }, top, title, sub, panel);
  const offLang = i18n.onChange(() => render(false));

  return {
    el,
    theme: 'results',
    enter() {
      sync();
      gsap.from(title, { scale: 0.3, opacity: 0, duration: 0.6, ease: 'elastic.out(1,0.5)' });
      gsap.from(panel, { y: 60, opacity: 0, duration: 0.6, delay: 0.2, ease: 'back.out(1.5)' });
      load();
    },
    leave() {
      seq++;
      offLang();
    },
    onKey(e) {
      if (e.key === 'Escape') app.go(homeScreen);
    },
  };
}
