/**
 * The Set Box's strip (docs: phase D): the featured set of the week with its four members (a tick on each one owned),
 * the seal granted for completing it, and when it rotates. Reads the cached wallet only; the Shop calls sync() whenever
 * the wallet, the language or the selected box changes.
 */
import { itemById, setById, type SetDef } from '../../../shared/cosmetics';
import { h } from '../../core/util';
import { t, tx, i18n } from '../../core/i18n';
import { RARITIES } from '../../core/rarity';
import { wallet } from '../../core/wallet';
import { itemArt } from './cosmeticReveal';

/** "Changes in 3d 4h" (or hours only inside the last day) */
export function endsIn(endsAt: number, now = Date.now()): string {
  const mins = Math.max(0, Math.ceil((endsAt - now) / 60_000));
  if (mins < 60) return t('setEndsSoon');
  const d = Math.floor(mins / 1440);
  const hrs = Math.floor((mins % 1440) / 60);
  return t('setEndsIn').replace('{d}', String(d)).replace('{h}', String(hrs));
}

export function featureStrip(): { el: HTMLElement; sync(featured: { set: string; endsAt: number } | null): void; set: SetDef | null } {
  const zh = h('b', { class: 'sf-zh' });
  const name = h('span', { class: 'sf-name' });
  const ends = h('span', { class: 'sf-ends' });
  const tiles = h('div', { class: 'sf-tiles' });
  const hint = h('span', { class: 'sf-hint' });
  const el = h(
    'div',
    { class: 'shop-feature' },
    h('div', { class: 'sf-head' }, h('span', { class: 'sf-kicker' }, tx('setWeek')), ends),
    h('div', { class: 'sf-title' }, zh, name),
    tiles,
    hint,
  );
  el.hidden = true;
  const api = {
    el,
    set: null as SetDef | null,
    sync(featured: { set: string; endsAt: number } | null) {
      const set = featured ? setById(featured.set) : undefined;
      api.set = set ?? null;
      el.hidden = !set;
      if (!set || !featured) return;
      zh.textContent = set.zh;
      name.textContent = set[i18n.lang];
      ends.textContent = endsIn(featured.endsAt);
      const cell = (id: string, bonus = false) => {
        const it = itemById(id);
        const own = wallet.owns(id);
        return h(
          'span',
          { class: `sf-tile${own ? ' own' : ''}${bonus ? ' bonus' : ''}`, style: it ? `--rc:${RARITIES[it.rarity].color}` : '', title: it?.[i18n.lang] ?? '' },
          h('span', { class: 'sf-art' }, itemArt(it)),
          own ? h('i', { class: 'sf-tick', 'aria-label': 'owned' }, '✓') : null,
        );
      };
      tiles.replaceChildren(...set.items.map((id) => cell(id)), h('span', { class: 'sf-plus', 'aria-hidden': 'true' }, '→'), cell(set.bonus, true));
      hint.textContent = wallet.owns(set.bonus) ? t('setBonusGot') : t('setBonusHint');
    },
  };
  return api;
}
