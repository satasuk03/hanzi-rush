/**
 * 商店 Shop (docs/cosmetics-shop.md §5.1, §11.6b). Three 宝匣 treasure chests bought with Jade; the server rolls
 * (POST /shop/pull), so the shop is online only. Shows each box's drop rates, its lowest rarity and the hard pity with
 * the player's own counter (store rules need the odds on screen). A purchase plays the opening ceremony with the
 * chest machine. Its own lazy chunk, opened from Home and from the Vault.
 */
import gsap from 'gsap';
import './vault.css';
import './shop.css';
import type { Screen } from '../../core/app';
import { app } from '../../core/app';
import { BOXES, BOX_MULTI, boxPrice, type BoxDef } from '../../../shared/cosmetics';
import { h, center, formatNum } from '../../core/util';
import { t, tx, i18n } from '../../core/i18n';
import { RARITIES } from '../../core/rarity';
import { wallet } from '../../core/wallet';
import { audio } from '../../engine/audio';
import { particles } from '../../engine/particles';
import { shake } from '../../engine/shake';
import { pop, pressable, nope, popIn } from '../../engine/juice';
import { langToggle, muteButton, iconButton, ICON } from '../../ui/widgets';
import { chestMachine, chestSVG, lidHop } from './chest';
import { Opening, type AgainResult } from './opening';
import { cosmeticBatch, jadePrice } from './cosmeticReveal';
import { buy, BuyError, resumePending } from './shopBuy';

let lastBox: BoxDef['id'] = 'standard';

export function toast(msg: string) {
  const el = h('div', { class: 'toast shop-toast' }, msg);
  document.getElementById('overlay')!.append(el);
  gsap.timeline({ onComplete: () => el.remove() })
    .from(el, { y: 60, opacity: 0, duration: 0.4, ease: 'back.out(2)' })
    .to(el, { y: -20, opacity: 0, duration: 0.3, delay: 2.6 });
}

const failText = (e: unknown) => {
  const k = e instanceof BuyError ? e.kind : 'error';
  return t(k === 'poor' ? 'shopPoor' : k === 'offline' ? 'shopConnect' : k === 'net' ? 'shopNetFail' : k === 'busy' ? 'tooMany' : 'shopFail');
};

export function create(from: 'home' | 'vault' = 'home'): Screen {
  let box = BOXES.find((b) => b.id === lastBox) ?? BOXES[0];
  let busy = false;
  /** balance the server reported with a refusal, until the wallet catches up */
  let jadeHint: number | null = null;
  let connecting = false;

  const back = () => (from === 'vault' ? import('./VaultScreen').then((m) => m.create()) : import('../../screens/home').then((m) => m.homeScreen()));
  const jade = () => jadeHint ?? wallet.jade;

  // ---- top bar
  const jadeV = h('span', { class: 'coin-v' });
  const jadePill = h('div', { class: 'coin-pill jade-pill' }, h('span', { class: 'coin-ic', html: ICON.jade }), jadeV);
  const top = h(
    'div',
    { class: 'topbar' },
    iconButton(ICON.back, 'Back', (e) => back().then((s) => app.go(() => s, { x: e.clientX, y: e.clientY }))),
    jadePill,
    h('div', { class: 'spacer' }),
    muteButton(),
    langToggle(),
  );
  const head = h('div', { class: 'vault-head' }, h('h1', { class: 'vault-title' }, '商店'), tx('shopTitle', 'span'));
  head.lastElementChild!.classList.add('vault-sub');

  // ---- box picker
  const tabs = BOXES.map((b) => {
    const name = h('span', { class: 'sb-name' });
    const el = h(
      'button',
      { class: 'shop-box', 'data-b': b.id, 'aria-label': b.en },
      h('span', { class: 'sb-art', html: chestSVG(b.id, 'sb-svg', true) }),
      h('span', { class: 'sb-zh' }, b.zh),
      name,
      h('span', { class: 'sb-price' }, h('span', { class: 'mini-coin', html: ICON.jade }), formatNum(b.price)),
    );
    return { b, el, name };
  });
  const picker = h('div', { class: 'shop-boxes' }, ...tabs.map((x) => x.el));

  // ---- the selected chest
  const stageArt = h('div', { class: 'shop-chest' });
  const stage = h('div', { class: 'shop-stage' }, h('span', { class: 'cab-aura' }), stageArt);

  // ---- panel
  const rates = h('div', { class: 'rates' });
  const floor = h('div', { class: 'pity shop-floor' });
  const pityLeft = h('b');
  const pityFill = h('span', { class: 'shop-pity-fill' });
  const pityCount = h('span', { class: 'shop-pity-n' });
  const pity = h('div', { class: 'shop-pity' }, h('div', { class: 'pity' }, tx('pityA'), ' ', pityLeft, ' ', tx('shopBoxes')), h('div', { class: 'shop-pity-row' }, h('span', { class: 'shop-pity-bar' }, pityFill), pityCount));
  const buyBtn = (qty: number) => {
    const label = h('span', { class: 'open-label' });
    const price = h('span', { class: 'open-price-v' });
    const el = h('button', { class: 'open-btn shop-buy', 'data-q': String(qty) }, h('span', { class: 'open-shine' }), label, h('span', { class: 'open-price' }, h('span', { class: 'mini-coin', html: ICON.jade }), price));
    return { qty, el, label, price };
  };
  const buys = [buyBtn(1), buyBtn(BOX_MULTI)];
  const note = h('div', { class: 'deal shop-note' });
  const panel = h('div', { class: 'vault-panel shop-panel' }, rates, floor, pity, h('div', { class: 'shop-buys' }, ...buys.map((b) => b.el)), note);

  const el = h('div', { class: 'screen vault shop' }, top, head, picker, stage, panel);

  // ---- sync
  const syncJade = () => {
    const j = jade();
    jadeV.textContent = j === null ? '–' : formatNum(j);
  };
  const syncBox = () => {
    el.dataset.box = box.id;
    tabs.forEach((x) => {
      x.el.classList.toggle('on', x.b === box);
      x.name.textContent = x.b[i18n.lang];
    });
    rates.replaceChildren(
      ...RARITIES.slice().reverse().map((R) => h('span', { class: `tier-chip rate${box.rates[R.i] ? '' : ' zero'}`, 'data-r': String(R.i) }, R.name, h('b', null, `${box.rates[R.i]}%`))),
    );
    floor.textContent = box.minRarity ? t('shopFloor').replace('{r}', RARITIES[box.minRarity].name) : '';
    floor.hidden = !box.minRarity;
    const n = Math.min(wallet.pity[box.id] ?? 0, box.pity - 1);
    pityLeft.textContent = String(box.pity - n);
    pityFill.style.transform = `scaleX(${n / box.pity})`;
    pityCount.textContent = `${n} / ${box.pity}`;
    syncBuy();
  };
  const syncBuy = () => {
    const j = jade();
    const online = wallet.enabled && j !== null;
    buys.forEach((b) => {
      const price = boxPrice(box, b.qty);
      b.label.textContent = `${t('open')} ×${b.qty}`;
      b.price.textContent = formatNum(price);
      b.el.classList.toggle('off', !online);
      b.el.classList.toggle('poor', online && j! < price);
    });
    let msg = t('tenDeal');
    let state = '';
    if (!online) {
      msg = connecting ? t('shopConnecting') : t('shopConnect');
      state = 'off';
    } else if (j! < box.price) {
      msg = t('shopPoor');
      state = 'poor';
    }
    note.textContent = msg;
    note.dataset.s = state;
    note.classList.toggle('hot', !state);
  };
  const sync = () => {
    syncJade();
    syncBox();
  };
  const setJade = (animate: boolean) => {
    const to = jade();
    if (!animate || to === null) return syncJade();
    const o = { v: Number(jadeV.textContent!.replace(/,/g, '')) || 0 };
    gsap.to(o, { v: to, duration: 0.6, ease: 'power2.out', onUpdate: () => (jadeV.textContent = formatNum(o.v)) });
    pop(jadePill, 0.6);
  };
  /** idle teaser: every few seconds the lid knocks twice, as if something inside wants out */
  let knock: gsap.core.Timeline | null = null;
  const stopKnock = () => {
    knock?.kill();
    knock = null;
  };
  const startKnock = () => {
    stopKnock();
    const svg = stageArt.querySelector('svg');
    if (!svg || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    knock = gsap.timeline({ repeat: -1, repeatDelay: 3.2, delay: 1.4 }).add(lidHop(svg)).add(lidHop(svg, true), '-=0.3');
  };
  const drawStage = (animate: boolean) => {
    stopKnock();
    stageArt.innerHTML = chestSVG(box.id, 'cab-svg', true);
    startKnock();
    if (animate) gsap.fromTo(stageArt, { scale: 0.6, y: -40 }, { scale: 1, y: 0, duration: 0.7, ease: 'elastic.out(1.1,0.5)' });
  };
  /** a manual hop (tap, purchase) pauses the idle knocking so the two never fight over the lid */
  const poke = (resume = true) => {
    stopKnock();
    const svg = stageArt.querySelector('svg');
    if (svg) lidHop(svg, true);
    if (resume) startKnock();
  };
  /** the chest thumps down: squash, then settle */
  const thud = () => gsap.fromTo(stageArt, { scaleX: 1.08, scaleY: 0.9 }, { scaleX: 1, scaleY: 1, duration: 0.6, ease: 'elastic.out(1.3,0.35)', transformOrigin: '50% 100%' });
  const refresh = () => {
    if (!wallet.enabled) return;
    connecting = wallet.jade === null;
    syncBuy();
    void wallet.refresh().then(() => {
      connecting = false;
      if (wallet.jade !== null) jadeHint = null;
      sync();
    });
  };

  const select = (i: number) => {
    const x = tabs[i];
    if (!x || busy) return;
    if (x.b === box) {
      audio.rattle(3);
      poke();
      return;
    }
    box = x.b;
    lastBox = box.id;
    audio.pop(1 + i * 0.15);
    pop(x.el, 0.6);
    drawStage(true);
    syncBox();
  };
  tabs.forEach((_, i) => pressable(tabs[i].el, () => select(i)));
  pressable(stageArt, () => {
    audio.rattle(4);
    shake(0.12);
    thud();
    poke();
    // light escapes the lid seam
    const r = stageArt.getBoundingClientRect();
    particles.burst(r.left + r.width / 2, r.top + r.height * 0.47, { count: 10, sprite: 'sparkGold', speed: [80, 260], size: [12, 22], g: -60, life: [0.4, 0.8], add: true, angle: -Math.PI / 2, spread: 1.6 });
  });

  // ---- purchase
  /** a purchase as the ceremony's "again": same box and size; failures are explained, the stage stays */
  const againFor = (b: BoxDef, qty: number) => async (): Promise<AgainResult> => {
    const j = jade();
    if (!wallet.enabled || j === null) {
      toast(t('shopConnect'));
      return 'failed';
    }
    if (j < boxPrice(b, qty)) {
      toast(t('shopPoor'));
      return 'poor';
    }
    try {
      const res = await buy(b.id, qty);
      jadeHint = null;
      return cosmeticBatch(b, res);
    } catch (e) {
      if (e instanceof BuyError && e.jade !== undefined) jadeHint = e.jade;
      toast(failText(e));
      return e instanceof BuyError && e.kind === 'poor' ? 'poor' : 'failed';
    }
  };

  /** dev builds without the API: play the ceremony with a fake pull */
  const demo = async (qty: number) => {
    const { demoPull } = await import('./devDemo');
    const bx = box;
    busy = true;
    poke(false);
    new Opening({
      host: el,
      machine: chestMachine(bx),
      batch: cosmeticBatch(bx, demoPull(bx, qty)),
      qty,
      price: jadePrice(boxPrice(bx, qty)),
      again: () => cosmeticBatch(bx, demoPull(bx, qty)),
      onClose: () => {
        busy = false;
        startKnock();
        thud();
      },
    });
  };

  const doBuy = async (b: (typeof buys)[number]) => {
    if (busy) return;
    audio.unlock();
    const j = jade();
    if (import.meta.env.DEV && (!wallet.enabled || j === null)) return void demo(b.qty);
    if (!wallet.enabled || j === null) {
      audio.wrong();
      nope(b.el);
      toast(t('shopConnect'));
      refresh();
      return;
    }
    const price = boxPrice(box, b.qty);
    if (j < price) {
      audio.wrong();
      nope(b.el);
      nope(jadePill);
      toast(t('shopPoor'));
      return;
    }
    const bx = box;
    busy = true;
    b.el.classList.add('is-loading');
    let res;
    try {
      res = await buy(bx.id, b.qty);
    } catch (e) {
      busy = false;
      b.el.classList.remove('is-loading');
      startKnock();
      if (e instanceof BuyError && e.jade !== undefined) jadeHint = e.jade;
      audio.wrong();
      nope(b.el);
      toast(failText(e));
      sync();
      return;
    }
    jadeHint = null;
    b.el.classList.remove('is-loading');
    // Jade flies from the wallet into the chest
    audio.spend(Math.min(12, 4 + b.qty));
    setJade(true);
    const cp = center(jadePill);
    particles.arc(cp.x, cp.y, () => center(stageArt), Math.min(14, 4 + b.qty), 'sparkCyan', () => audio.coin(Math.floor(Math.random() * 6)));
    poke(false);
    pop(b.el, 1);
    shake(0.2);
    await new Promise((r) => setTimeout(r, 650));
    new Opening({
      host: el,
      machine: chestMachine(bx),
      batch: cosmeticBatch(bx, res),
      qty: b.qty,
      price: jadePrice(boxPrice(bx, b.qty)),
      again: againFor(bx, b.qty),
      onClose: () => {
        busy = false;
        setJade(true);
        syncBox();
        startKnock();
        thud();
      },
    });
  };
  buys.forEach((b) => pressable(b.el, () => void doBuy(b)));

  /** a purchase the app never saw the answer to (killed mid-buy): re-send it with its ref and show what it gave */
  let left = false;
  const recover = async () => {
    if (busy || !wallet.pending) return;
    busy = true;
    const r = await resumePending();
    const bx = r && BOXES.find((x) => x.id === r.box);
    if (left || !r || !bx) {
      busy = false;
      return;
    }
    jadeHint = null;
    setJade(true);
    new Opening({
      host: el,
      machine: chestMachine(bx),
      batch: cosmeticBatch(bx, r.res),
      qty: r.qty,
      price: jadePrice(boxPrice(bx, r.qty)),
      again: againFor(bx, r.qty),
      onClose: () => {
        busy = false;
        setJade(true);
        syncBox();
        startKnock();
      },
    });
  };

  const offWallet = wallet.on(() => {
    if (!busy) sync();
  });
  const offLang = i18n.onChange(syncBox);

  return {
    el,
    theme: 'vault',
    enter() {
      left = false;
      drawStage(false);
      sync();
      refresh();
      void wallet.refresh().then(recover);
      gsap.from(head.children, { y: -30, opacity: 0, stagger: 0.08, duration: 0.6, ease: 'back.out(2)' });
      popIn(tabs.map((x) => x.el), 0.1, 0.07);
      gsap.from(stageArt, { y: -innerHeight * 0.35, opacity: 0, duration: 0.45, delay: 0.2, ease: 'power3.in', onComplete: () => {
        thud();
        shake(0.15);
        audio.pop(0.7);
        const r = stageArt.getBoundingClientRect();
        particles.burst(r.left + r.width / 2, r.bottom - 6, { count: 12, sprite: 'paper', speed: [120, 320], size: [10, 18], g: 400, life: [0.4, 0.7], angle: -Math.PI / 2, spread: 2.6 });
      } });
      gsap.from(panel, { y: 90, opacity: 0, duration: 0.7, delay: 0.15, ease: 'back.out(1.4)' });
    },
    leave() {
      left = true;
      stopKnock();
      offLang();
      offWallet();
      Opening.current?.destroy();
    },
    onKey(e) {
      if (Opening.current) return Opening.current.onKey(e);
      const i = BOXES.indexOf(box);
      if (e.key === 'ArrowLeft') select(i - 1);
      if (e.key === 'ArrowRight') select(i + 1);
      if (e.key === 'Escape') back().then((s) => app.go(() => s));
    },
  };
}
