/**
 * The Shop's "Deals" tab: three direct-buy items per day (Bangkok day), picked by the server for this player from what
 * they do not own yet. Each is bought once for a fixed Jade price (GET / POST /shop/deals). Online only. A purchase
 * keeps one idempotency ref per (day, slot) across retries, so a dropped connection never charges twice; after an app
 * kill the next GET shows the slot as bought and the wallet shows the item.
 */
import type { ShopDeal, ShopDealsResponse } from '../../../shared/api';
import { SETS, itemById } from '../../../shared/cosmetics';
import { ApiError } from '../../core/api';
import { h, center, formatNum, wait } from '../../core/util';
import { t, tx, i18n } from '../../core/i18n';
import { RARITIES } from '../../core/rarity';
import { newPullRef, wallet } from '../../core/wallet';
import { equipItem, isEquipped, unequipItem } from '../../cosmetics/equip';
import { audio } from '../../engine/audio';
import { particles } from '../../engine/particles';
import { shake } from '../../engine/shake';
import { pop, pressable, nope } from '../../engine/juice';
import { notify } from '../../ui/notify';
import { ICON } from '../../ui/widgets';
import { itemArt } from './cosmeticReveal';
import { SPARK } from './fx';

const RETRIES = 3;
const CONFIRM_MS = 3000;

export interface DealsHost {
  toast(msg: string): void;
  /** the Jade pill, so a purchase can fly Jade out of it */
  jadePill: HTMLElement;
}

export function dealsView(host: DealsHost): { el: HTMLElement; enter(): void; leave(): void; sync(): void } {
  let data: ShopDealsResponse | null = null;
  let state: 'loading' | 'ready' | 'offline' | 'fail' = 'loading';
  let busy = false;
  let left = false;
  /** the slot waiting for its second tap, until CONFIRM_MS pass */
  let armed: { slot: number; timer: number } | null = null;
  /** one ref per purchase attempt, kept until the server answers definitively */
  const refs = new Map<string, string>();
  /** item ids bought while this view was open: they get an Equip button */
  const mine = new Set<string>();
  let tick = 0;
  let gen = 0;

  const ends = h('span', { class: 'dl-ends' });
  const list = h('div', { class: 'dl-list' });
  const note = h('div', { class: 'deal dl-note' });
  const el = h(
    'div',
    { class: 'vault-panel shop-panel dl-panel', hidden: true },
    h('div', { class: 'dl-head' }, h('span', { class: 'dl-kicker' }, tx('dealsTitle')), ends),
    list,
    note,
  );

  const disarm = () => {
    if (armed) clearTimeout(armed.timer);
    armed = null;
  };

  const endsText = () => {
    if (!data) return '';
    const mins = Math.max(0, Math.ceil((data.endsAt - Date.now()) / 60_000));
    if (mins < 1) return t('dealsEndsSoon');
    return t('dealsEndsIn').replace('{h}', String(Math.floor(mins / 60))).replace('{m}', String(mins % 60));
  };

  const poor = (d: ShopDeal) => wallet.jade !== null && wallet.jade < d.price;

  const card = (d: ShopDeal) => {
    const it = itemById(d.itemId);
    const R = RARITIES[d.rarity] ?? RARITIES[0];
    const done = d.bought || d.owned;
    const mineNow = mine.has(d.itemId) && wallet.owns(d.itemId);
    const confirming = armed?.slot === d.slot;
    let label: Node | string;
    let cls = 'dl-btn';
    if (mineNow) {
      cls += ' equip';
      label = isEquipped(d.itemId) ? `✓ ${t('equipped')}` : t('equip');
    } else if (done) {
      cls += ' done';
      label = `✓ ${d.bought ? t('dealBought') : t('dealOwned')}`;
    } else {
      if (poor(d)) cls += ' poor';
      if (confirming) cls += ' arm';
      label = h('span', { class: 'dl-price' }, confirming ? `${t('dealConfirm')} ` : `${t('dealBuy')} `, h('span', { class: 'mini-coin', html: ICON.jade }), formatNum(d.price));
    }
    const btn = h('button', { class: cls, 'data-slot': String(d.slot), disabled: done && !mineNow ? true : undefined }, label);
    const row = h(
      'div',
      { class: `dl-card${done ? ' done' : ''}`, 'data-r': String(d.rarity), style: `--rc:${R.color}` },
      h('span', { class: 'dl-art' }, itemArt(it)),
      h('span', { class: 'dl-text' }, h('span', { class: 'dl-name' }, it?.[i18n.lang] ?? d.itemId), h('span', { class: 'tier-chip dl-rar', 'data-r': String(d.rarity) }, R.name)),
      btn,
    );
    if (!(done && !mineNow)) pressable(btn, () => void onTap(d, row, btn));
    return row;
  };

  const draw = () => {
    ends.textContent = state === 'ready' ? endsText() : '';
    if (state !== 'ready' || !data) {
      list.replaceChildren();
      note.textContent = state === 'offline' ? t('shopConnect') : state === 'fail' ? t('dealsFail') : t('dealsLoading');
      note.dataset.s = state === 'loading' ? '' : 'off';
      note.hidden = false;
      return;
    }
    list.replaceChildren(...data.deals.map(card));
    const allOwned = data.deals.every((d) => d.bought || d.owned);
    note.hidden = !(allOwned || !data.deals.length);
    note.textContent = t('dealsEmpty');
    note.dataset.s = '';
  };

  /** fetch today's deals; `quiet` keeps the cards on screen while it runs */
  const load = async (quiet = false) => {
    const g = ++gen;
    if (!wallet.enabled || !navigator.onLine) {
      state = 'offline';
      return draw();
    }
    if (!quiet || !data) {
      state = 'loading';
      draw();
    }
    try {
      const r = await wallet.deals();
      if (g !== gen || left) return;
      data = r;
      state = 'ready';
      // a day that turned: refs of the old day are dead
      for (const k of [...refs.keys()]) if (!k.startsWith(r.day)) refs.delete(k);
    } catch (e) {
      if (g !== gen || left) return;
      state = e instanceof ApiError && e.status === 0 ? 'offline' : 'fail';
    }
    draw();
  };

  /** failures of a purchase: what happened, and whether the cards should be refetched */
  const explain = (e: unknown, btn: HTMLElement) => {
    audio.wrong();
    nope(btn);
    if (!(e instanceof ApiError)) return host.toast(t('shopNetFail'));
    const reason = e.body?.error.reason;
    if (e.code === 'insufficient_jade') {
      nope(host.jadePill);
      void wallet.refresh();
      return host.toast(t('shopPoor'));
    }
    if (reason === 'rotated') {
      host.toast(t('dealsRotated'));
      return void load(true);
    }
    if (reason === 'owned' || reason === 'bought' || reason === 'no_deal') {
      host.toast(t('dealsGone'));
      void wallet.refresh();
      return void load(true);
    }
    host.toast(t(e.status === 0 ? 'shopNetFail' : e.status === 429 ? 'tooMany' : 'shopFail'));
  };

  const send = async (day: string, slot: number, ref: string) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await wallet.buyDeal(day, slot, ref);
      } catch (e) {
        if (!(e instanceof ApiError) || !e.transient || (e.status === 0 && !navigator.onLine) || attempt >= RETRIES) throw e;
        await wait(e.status === 429 ? Math.max(1, e.retryAfter ?? 1) * 1000 + 150 : 600 * (attempt + 1));
      }
    }
  };

  const onTap = async (d: ShopDeal, row: HTMLElement, btn: HTMLElement) => {
    if (busy || !data) return;
    audio.unlock();
    // an owned deal that was bought here toggles equipped
    if (mine.has(d.itemId) && wallet.owns(d.itemId)) {
      if (isEquipped(d.itemId)) unequipItem(d.itemId);
      else if (!equipItem(d.itemId)) return;
      audio.pop(1.3);
      pop(btn, 0.6);
      return draw();
    }
    if (!wallet.enabled || !navigator.onLine) {
      audio.wrong();
      nope(btn);
      return host.toast(t('shopConnect'));
    }
    if (poor(d)) {
      audio.wrong();
      nope(btn);
      nope(host.jadePill);
      return host.toast(t('shopPoor'));
    }
    if (armed?.slot !== d.slot) {
      // first tap: the button asks again, and goes back after a moment
      disarm();
      armed = { slot: d.slot, timer: window.setTimeout(() => (disarm(), draw()), CONFIRM_MS) };
      audio.tick();
      draw();
      return;
    }
    disarm();
    busy = true;
    btn.classList.add('is-loading');
    const key = `${data.day}:${d.slot}`;
    const ref = refs.get(key) ?? newPullRef();
    refs.set(key, ref);
    try {
      const r = await send(data.day, d.slot, ref);
      refs.delete(key);
      if (left) return;
      if (r.replay) void wallet.refresh();
      d.bought = true;
      d.owned = true;
      mine.add(r.itemId);
      audio.spend(6);
      audio.reveal(d.rarity);
      draw();
      const fresh = list.querySelector<HTMLElement>(`[data-slot="${d.slot}"]`)?.closest<HTMLElement>('.dl-card') ?? row;
      pop(fresh, 1.4);
      shake(0.12 + d.rarity * 0.05);
      const c = center(fresh);
      particles.burst(c.x, c.y, { count: 16 + d.rarity * 8, sprite: SPARK[d.rarity], speed: [160, 460], size: [12, 22], g: 300, drag: 2, life: [0.4, 0.8], add: true, stretch: true });
      particles.ring(c.x, c.y, 100, RARITIES[d.rarity].color, 8);
      (r.bonuses ?? []).forEach((id, i) => {
        const bi = itemById(id);
        const set = SETS.find((x) => x.bonus === id);
        if (bi && set) notify({ kicker: t('setComplete'), title: set[i18n.lang], seal: bi.zh[0], tier: bi.rarity }, 0.5 + i * 0.5);
      });
    } catch (e) {
      // a definitive refusal ends this attempt; a network failure keeps the ref for the next tap
      if (e instanceof ApiError && !e.transient) refs.delete(key);
      if (!left) explain(e, btn);
    } finally {
      busy = false;
      btn.classList.remove('is-loading');
    }
  };

  let offWallet = () => {};
  let offLang = () => {};

  return {
    el,
    sync: draw,
    enter() {
      left = false;
      offWallet();
      offLang();
      offWallet = wallet.on(() => {
        if (!left && !busy && state === 'ready') draw();
      });
      offLang = i18n.onChange(() => !left && draw());
      void load(!!data);
      window.clearInterval(tick);
      tick = window.setInterval(() => {
        if (state !== 'ready' || !data) return;
        // the day turned while the tab was open: new deals
        if (Date.now() >= data.endsAt) void load(true);
        else ends.textContent = endsText();
      }, 20_000);
    },
    leave() {
      left = true;
      disarm();
      window.clearInterval(tick);
      offWallet();
      offLang();
    },
  };
}
