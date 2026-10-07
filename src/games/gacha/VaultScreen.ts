/**
 * 宝库 Treasure Vault. Six cabinets (one per HSK level) on a snap carousel. Pick how many
 * cards (1–10), pay coins, and the opening ceremony takes over the screen.
 */
import gsap from 'gsap';
import './vault.css';
import type { Screen } from '../../core/app';
import { app } from '../../core/app';
import { LEVELS, loadLevel } from '../../core/data';
import { h, center, formatNum, clamp } from '../../core/util';
import { t, tx, i18n } from '../../core/i18n';
import { store } from '../../core/store';
import { RARITIES } from '../../core/rarity';
import { audio } from '../../engine/audio';
import { particles } from '../../engine/particles';
import { shake } from '../../engine/shake';
import { pop, pressable, nope, popIn, loop } from '../../engine/juice';
import { langToggle, muteButton, iconButton, ICON, shopChip } from '../../ui/widgets';
import { cabinetMachine, cabinetSVG, HALLS } from './cabinet';
import { HARD_PITY, MAX_QTY, priceFor, pull, ownedCount } from './gacha';
import { Opening } from './opening';
import { wordBatch, wordPrice } from './wordReveal';

let lastIdx = 0;
let lastQty = 1;

export function create(): Screen {
  let idx = lastIdx;
  let qty = lastQty;
  let busy = false;

  const home = () => import('../../screens/home').then((m) => m.homeScreen());

  // ---- top bar
  const coinV = h('span', { class: 'coin-v' }, formatNum(store.progress.coins));
  const coinPill = h('div', { class: 'coin-pill' }, h('span', { class: 'coin-ic', html: ICON.coin }), coinV);
  const top = h(
    'div',
    { class: 'topbar' },
    iconButton(ICON.back, 'Back', (e) => home().then((s) => app.go(() => s, { x: e.clientX, y: e.clientY }))),
    coinPill,
    h('div', { class: 'spacer' }),
    muteButton(),
    langToggle(),
  );
  const shop = shopChip((e) => import('./ShopScreen').then((m) => app.go(() => m.create('vault'), { x: e.clientX, y: e.clientY })));
  const head = h('div', { class: 'vault-head' }, h('h1', { class: 'vault-title' }, '宝库'), h('span', { class: 'vault-sub' }, tx('vaultTitle')), shop);

  // ---- carousel
  const slides = LEVELS.map((L) => {
    const bar = h('span', { class: 'cab-bar-fill' });
    const count = h('span', { class: 'cab-count' });
    const cab = h('div', { class: 'cab', html: cabinetSVG(L) });
    const inner = h(
      'span',
      { class: 'slide-in' },
      h('span', { class: 'cab-aura' }),
      cab,
      h('span', { class: 'cab-name' }, h('b', null, `HSK ${L.n}`), h('span', null, `${HALLS[L.n - 1]}阁`)),
      h('span', { class: 'cab-prog' }, h('span', { class: 'cab-bar' }, bar), count),
    );
    const s = h('button', { class: 'vault-slide', style: `--c:${L.color};--d:${L.dark}`, 'aria-label': `HSK ${L.n}` }, inner);
    return { s, inner, cab, bar, count, L };
  });
  const track = h('div', { class: 'vault-track' }, ...slides.map((x) => x.s));
  const dots = h('div', { class: 'vault-dots' }, ...LEVELS.map(() => h('i')));
  const arrowL = h('button', { class: 'vault-arrow l', 'aria-label': 'Previous', html: ICON.back });
  const arrowR = h('button', { class: 'vault-arrow r', 'aria-label': 'Next', html: ICON.back });
  const carousel = h('div', { class: 'vault-carousel' }, track, arrowL, arrowR);

  // ---- panel
  const rates = h('div', { class: 'rates' }, ...RARITIES.slice().reverse().map((R) => h('span', { class: 'tier-chip rate', 'data-r': String(R.i) }, R.name, h('b', null, `${+(R.rate * 100).toFixed(1)}%`))));
  const pityV = h('b');
  const pity = h('div', { class: 'pity' }, tx('pityA'), ' ', pityV, ' ', tx('pityB'));
  const qtyV = h('span', { class: 'qty-v' });
  const minus = h('button', { class: 'qty-btn', 'aria-label': 'Less' }, '−');
  const plus = h('button', { class: 'qty-btn', 'aria-label': 'More' }, '+');
  const quick = [1, 5, 10].map((n) => h('button', { class: 'qty-chip', 'data-n': String(n) }, `×${n}`));
  const qtyRow = h('div', { class: 'qty-row' }, h('div', { class: 'qty' }, minus, qtyV, plus), h('div', { class: 'qty-quick' }, ...quick));
  const priceV = h('span', { class: 'open-price-v' });
  const openLabel = h('span', { class: 'open-label' });
  const openBtn = h('button', { class: 'open-btn' }, h('span', { class: 'open-shine' }), openLabel, h('span', { class: 'open-price' }, h('span', { class: 'mini-coin', html: ICON.coin }), priceV));
  const deal = h('div', { class: 'deal' }, tx('tenDeal'));
  const panel = h('div', { class: 'vault-panel' }, rates, pity, qtyRow, openBtn, deal);

  const navBtn = (glyph: string, key: 'collection' | 'profile', go: () => Promise<Screen>) => {
    const b = h('button', { class: 'vault-nav' }, h('span', { class: 'vn-glyph' }, glyph), tx(key));
    pressable(b, (e) => {
      audio.pop(1.1);
      go().then((s) => app.go(() => s, { x: e.clientX, y: e.clientY }));
    });
    return b;
  };
  const foot = h(
    'div',
    { class: 'vault-foot' },
    navBtn('图', 'collection', () => import('./collection').then((m) => m.create())),
    navBtn('我', 'profile', () => import('./profile').then((m) => m.create())),
  );

  const el = h('div', { class: 'screen vault' }, top, head, carousel, dots, panel, foot);

  // ---- sync
  const syncLevel = () => {
    const L = LEVELS[idx];
    el.style.setProperty('--lc', L.color);
    el.style.setProperty('--ld', L.dark);
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === idx));
    slides.forEach((x) => {
      const n = ownedCount(x.L.n);
      x.count.textContent = `${formatNum(n)} / ${formatNum(x.L.count)}`;
      x.bar.style.transform = `scaleX(${n / x.L.count})`;
    });
    arrowL.classList.toggle('off', idx === 0);
    arrowR.classList.toggle('off', idx === LEVELS.length - 1);
    syncQty();
  };
  const syncQty = () => {
    const price = priceFor(LEVELS[idx].n, qty);
    qtyV.textContent = String(qty);
    openLabel.textContent = `${t('open')} ×${qty}`;
    priceV.textContent = formatNum(price);
    openBtn.classList.toggle('poor', store.progress.coins < price);
    deal.classList.toggle('hot', qty === MAX_QTY);
    quick.forEach((b) => b.classList.toggle('on', Number(b.dataset.n) === qty));
    minus.classList.toggle('off', qty <= 1);
    plus.classList.toggle('off', qty >= MAX_QTY);
    pityV.textContent = String(HARD_PITY - store.progress.pity);
  };
  const setCoins = (animate: boolean) => {
    const to = store.progress.coins;
    if (!animate) return void (coinV.textContent = formatNum(to));
    const o = { v: Number(coinV.textContent!.replace(/,/g, '')) };
    gsap.to(o, { v: to, duration: 0.6, ease: 'power2.out', onUpdate: () => (coinV.textContent = formatNum(o.v)) });
    pop(coinPill, 0.6);
  };
  const setQty = (n: number) => {
    const next = clamp(n, 1, MAX_QTY);
    if (next === qty) return nope(qtyV);
    qty = lastQty = next;
    audio.pop(0.8 + qty * 0.05);
    pop(qtyV, 0.8);
    syncQty();
  };
  pressable(minus, () => setQty(qty - 1));
  pressable(plus, () => setQty(qty + 1));
  quick.forEach((b) => pressable(b, () => setQty(Number(b.dataset.n))));

  // carousel: native scroll-snap, depth effect computed from scroll position
  const slideW = () => (slides[1]?.s.offsetLeft ?? 0) - slides[0].s.offsetLeft || 1;
  const onScroll = () => {
    const x = track.scrollLeft / slideW();
    slides.forEach((s, i) => {
      const d = Math.min(1, Math.abs(i - x));
      s.inner.style.transform = `scale(${1 - d * 0.24}) translateY(${d * 20}px)`;
      s.inner.style.opacity = String(1 - d * 0.5);
    });
    const ni = clamp(Math.round(x), 0, LEVELS.length - 1);
    if (ni !== idx) {
      idx = lastIdx = ni;
      audio.tick();
      syncLevel();
    }
  };
  track.addEventListener('scroll', onScroll, { passive: true });
  const goTo = (i: number, smooth = true) => {
    i = clamp(i, 0, LEVELS.length - 1);
    track.scrollTo({ left: i * slideW(), behavior: smooth ? 'smooth' : 'auto' });
  };
  pressable(arrowL, () => (audio.click(), goTo(idx - 1)));
  pressable(arrowR, () => (audio.click(), goTo(idx + 1)));
  slides.forEach((x, i) =>
    pressable(x.s, () => {
      if (i !== idx) return goTo(i);
      // poke the cabinet: it rattles
      audio.rattle(4);
      shake(0.12);
      gsap.fromTo(x.cab, { rotation: -3 }, { rotation: 0, duration: 0.6, ease: 'elastic.out(1.4,0.3)' });
      const c = center(x.cab);
      particles.burst(c.x, c.y, { count: 8, sprite: 'sparkGold', speed: [80, 240], size: [12, 22], g: -60, life: [0.4, 0.8], add: true });
    }),
  );

  // ---- open!
  const doOpen = async () => {
    if (busy) return;
    const L = LEVELS[idx];
    const price = priceFor(L.n, qty);
    audio.unlock();
    if (store.progress.coins < price) {
      audio.wrong();
      nope(openBtn);
      nope(coinPill);
      toast(t('notEnough'));
      return;
    }
    busy = true;
    openBtn.classList.add('is-loading');
    let words;
    try {
      words = await loadLevel(L.n);
    } catch {
      busy = false;
      openBtn.classList.remove('is-loading');
      toast(t('loadFail'));
      return;
    }
    openBtn.classList.remove('is-loading');
    const batch = pull(L.n, words, qty);
    if (!batch) {
      busy = false;
      return;
    }
    // coins fly from the wallet into the cabinet
    audio.spend(Math.min(12, 4 + qty));
    setCoins(true);
    const cabC = () => center(slides[idx].cab);
    const cp = center(coinPill);
    particles.arc(cp.x, cp.y, cabC, Math.min(14, 4 + qty), 'coin', () => audio.coin(Math.floor(Math.random() * 6)));
    pop(openBtn, 1);
    shake(0.2);
    await new Promise((r) => setTimeout(r, 650));
    new Opening({
      host: el,
      machine: cabinetMachine(L),
      batch: wordBatch(L, batch),
      qty,
      price: wordPrice(L, qty),
      again: () => {
        const b = pull(L.n, words, qty);
        setCoins(false);
        syncLevel();
        return b ? wordBatch(L, b) : 'poor';
      },
      onClose: () => {
        busy = false;
        setCoins(true);
        syncLevel();
        background();
      },
    });
  };
  pressable(openBtn, doOpen);

  const background = () => {
    // the cabinet you just opened gets a little celebratory bounce
    const x = slides[idx];
    gsap.fromTo(x.cab, { scale: 0.85 }, { scale: 1, duration: 0.7, ease: 'elastic.out(1.2,0.4)' });
  };

  const offLang = i18n.onChange(syncQty);

  return {
    el,
    theme: 'vault',
    enter() {
      syncLevel();
      setCoins(false);
      requestAnimationFrame(() => {
        goTo(idx, false);
        onScroll();
      });
      gsap.from(head.children, { y: -30, opacity: 0, stagger: 0.08, duration: 0.6, ease: 'back.out(2)' });
      gsap.from(slides[idx].cab, { scale: 0, rotation: -12, duration: 0.9, delay: 0.1, ease: 'elastic.out(1,0.5)' });
      gsap.from(panel, { y: 90, opacity: 0, duration: 0.7, delay: 0.15, ease: 'back.out(1.4)' });
      popIn(foot.children as unknown as Element[], 0.3, 0.08);
      loop('vaultHub:open', openBtn, () => gsap.to(openBtn, { scale: 1.03, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' }), { scale: 1 });
      slides.forEach((x, i) => loop(`vaultHub:bob${i}`, x.cab, () => gsap.to(x.cab, { y: -7, duration: 1.4 + i * 0.1, yoyo: true, repeat: -1, ease: 'sine.inOut' }), { y: 0 }));
    },
    leave() {
      offLang();
      Opening.current?.destroy();
    },
    onKey(e) {
      if (Opening.current) return Opening.current.onKey(e);
      if (e.key === 'ArrowLeft') goTo(idx - 1);
      if (e.key === 'ArrowRight') goTo(idx + 1);
      if (e.key === 'ArrowUp' || e.key === '+') setQty(qty + 1);
      if (e.key === 'ArrowDown' || e.key === '-') setQty(qty - 1);
      if (e.key === 'Enter') doOpen();
      if (e.key === 'Escape') home().then((s) => app.go(() => s));
    },
  };
}

export function toast(msg: string) {
  const el = h('div', { class: 'toast' }, msg);
  document.getElementById('overlay')!.append(el);
  gsap.timeline({ onComplete: () => el.remove() })
    .from(el, { y: 60, opacity: 0, duration: 0.4, ease: 'back.out(2)' })
    .to(el, { y: -20, opacity: 0, duration: 0.3, delay: 2.2 });
}
