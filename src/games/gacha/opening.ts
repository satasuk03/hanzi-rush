/**
 * The opening ceremony. The machine rattles, its seam glows and steps up through the
 * rarity colours to the best item in the batch, then it bursts open. Each card flies
 * out face down with an aura that hints at its rarity; a tap flips it (WebGL) and the
 * reveal FX scale with rarity. Ends with a summary grid, or action buttons for a single pull.
 *
 * What is revealed is behind `Reveal` (word cards: wordReveal.ts, cosmetics: cosmeticReveal.ts), the art that opens
 * is a `Machine` (the HSK cabinet, the lantern box), and "again" may be a network call (async, can fail).
 */
import gsap from 'gsap';
import './opening.css';
import { h, center, rand, wait, formatNum } from '../../core/util';
import { t, tx, i18n } from '../../core/i18n';
import { RARITIES } from '../../core/rarity';
import type { Title } from '../../core/meta';
import { audio } from '../../engine/audio';
import { particles } from '../../engine/particles';
import { shake, punch } from '../../engine/shake';
import { flipper } from '../../engine/flip3d';
import { pop, pressable, nope, loop, stopLoop, stopAllLoops } from '../../engine/juice';
import { announceTitles } from '../../ui/notify';
import { drawCardBack, CARD_RATIO } from './cardArt';
import { gcard, type GCard } from './gcard';
import { SPARK, flash, revealFx } from './fx';

/** one thing that comes out of the machine */
export interface Reveal {
  /** 0 COMMON .. 4 MYTHIC */
  rarity: number;
  isNew: boolean;
  /** copies owned after this one */
  copies: number;
  /** currency given back for a duplicate (0 = none) */
  refund: number;
  /** paints the face-up card for the current language (a canvas, so the WebGL flip can texture it) */
  paint(width: number): HTMLCanvasElement;
  /** live DOM laid over the face once it is up (art the canvas cannot draw: CSS effects, images) */
  layer?(): HTMLElement | null;
  /** the face just landed (e.g. pronounce the word) */
  shown?(): void;
  /** single pull only: an extra control under the rarity line (e.g. Equip) */
  extra?(): HTMLElement | null;
  /** its tile in the summary grid (handles its own taps) */
  tile(): HTMLElement;
}

export interface RevealBatch {
  reveals: Reveal[];
  /** highest rarity in the batch (how far the seam light climbs) */
  best: number;
  /** what is being opened, shown in the counter and the summary ("HSK 3", "漆匣") */
  label: string;
  /** resolves when the faces can be painted (fonts, images); the ceremony waits for it after the burst */
  ready?: Promise<unknown>;
  /** titles earned by this batch, toasted when the stage goes away */
  titles?: Title[];
  /** the face-down side (default: the vault's 宝 card back) */
  back?(width: number): HTMLCanvasElement;
}

/** the art that bursts open. Its SVG root has class `cab-svg`; `.cab-seam` flashes on each escalation step. */
export interface Machine {
  svg: string;
  /** the parts fly open (the light, particles and sound around it are the ceremony's) */
  open(svg: Element): void;
}

/** price of one more batch of the same size, for the "again" button and the refund tags */
export interface Price {
  /** currency icon (SVG markup) */
  icon: string;
  amount: number;
}

/** 'poor' = cannot afford (the button greys out); 'failed' = anything else (the caller explains, the stage stays) */
export type AgainResult = RevealBatch | 'poor' | 'failed';

export interface OpeningOpts {
  host: HTMLElement;
  machine: Machine;
  batch: RevealBatch;
  qty: number;
  price: Price;
  /** another batch of the same size. May be async (a network purchase): the button shows a pending state meanwhile. */
  again: () => AgainResult | Promise<AgainResult>;
  onClose: () => void;
}

let backCache: { w: number; cv: HTMLCanvasElement } | null = null;
function cardBack(w: number) {
  if (!backCache || backCache.w !== w) backCache = { w, cv: drawCardBack(document.createElement('canvas'), w) };
  const cv = document.createElement('canvas');
  cv.width = backCache.cv.width;
  cv.height = backCache.cv.height;
  cv.style.width = backCache.cv.style.width;
  cv.style.height = backCache.cv.style.height;
  cv.getContext('2d')!.drawImage(backCache.cv, 0, 0);
  return cv;
}

export class Opening {
  /** the ceremony on screen, if any (keyboard routing) */
  static current: Opening | null = null;
  el: HTMLElement;
  private o: OpeningOpts;
  private cab: HTMLElement;
  private rays: HTMLElement;
  private slot: HTMLElement;
  private info: HTMLElement;
  private counter: HTMLElement;
  private hint: HTMLElement;
  private skipBtn: HTMLElement;
  private sum: HTMLElement;
  private cardW: number;
  private card: GCard | null = null;
  private skipped = false;
  private closed = false;
  private waiter: (() => void) | null = null;
  private tapReady = false;
  /** repaint of the face-up card, for language switches */
  private repaint: (() => void) | null = null;
  private offLang: () => void;

  constructor(o: OpeningOpts) {
    this.o = o;
    this.cardW = Math.round(Math.min(innerWidth * 0.7, 320, (innerHeight - 250) / CARD_RATIO));
    this.rays = h('div', { class: 'vs-rays' });
    this.cab = h('div', { class: 'vs-cab', html: o.machine.svg });
    this.cab.append(h('span', { class: 'vs-flare' }, h('i')));
    this.slot = h('div', { class: 'vs-slot' });
    this.info = h('div', { class: 'vs-info' });
    this.counter = h('span', { class: 'vs-count' });
    this.skipBtn = h('button', { class: 'vs-skip' }, tx('skip'), h('span', null, ' ▸▸'));
    this.hint = h('div', { class: 'vs-hint' });
    this.sum = h('div', { class: 'vs-sum' });
    this.el = h(
      'div',
      { class: 'vs' },
      h('div', { class: 'vs-bg' }),
      this.rays,
      h('div', { class: 'vs-glow' }),
      this.cab,
      this.slot,
      this.info,
      h('div', { class: 'vs-top' }, this.counter, this.skipBtn),
      this.hint,
      this.sum,
    );
    pressable(this.skipBtn, () => this.skip());
    this.el.addEventListener('pointerup', (e) => {
      if ((e.target as HTMLElement).closest('.vs-skip, .vs-sum, .vs-actions, .vs-extra')) return;
      this.tap();
    });
    this.offLang = i18n.onChange(() => this.repaint?.());
    this.el.style.setProperty('--card-h', `${Math.round(this.cardW * CARD_RATIO)}px`);
    o.host.append(this.el);
    Opening.current = this;
    this.run();
  }

  // ------------------------------------------------------------------ plumbing
  private tap() {
    if (!this.tapReady) return;
    this.tapReady = false;
    const w = this.waiter;
    this.waiter = null;
    w?.();
  }

  /** resolves on tap (or immediately once skipped) */
  private waitTap() {
    if (this.skipped) return Promise.resolve();
    return new Promise<void>((r) => {
      this.waiter = r;
      this.tapReady = true;
    });
  }

  /** a pause the skip button can cut short */
  private pause(ms: number) {
    if (this.skipped) return Promise.resolve();
    return Promise.race([wait(ms), new Promise<void>((r) => (this.waiter = r))]);
  }

  private skip() {
    if (this.skipped || this.closed) return;
    this.skipped = true;
    audio.swoosh();
    gsap.to(this.skipBtn, { opacity: 0, duration: 0.2 });
    const w = this.waiter;
    this.waiter = null;
    w?.();
  }

  onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') this.skip();
    if (e.key === 'Enter' || e.key === ' ') this.tap();
  }

  private setTone(r: number, power: number) {
    const R = RARITIES[r];
    this.el.style.setProperty('--vglow', R.color);
    this.el.style.setProperty('--rc', R.color);
    this.el.style.setProperty('--rg', R.glow);
    this.el.style.setProperty('--pw', String(power));
    this.el.dataset.tone = String(r);
  }

  private showHint(text: string) {
    this.hint.textContent = text;
    gsap.fromTo(this.hint, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.35, ease: 'back.out(2)' });
    loop('vault:hint', this.hint, () => gsap.to(this.hint, { y: -5, duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' }), { y: 0 });
  }
  private hideHint() {
    stopLoop('vault:hint');
    gsap.to(this.hint, { opacity: 0, duration: 0.15 });
  }

  // ------------------------------------------------------------------ flow
  private async run() {
    const { batch } = this.o;
    const best = batch.best;
    const fonts = batch.ready;
    this.setTone(0, 0.3);
    this.counter.textContent = `${batch.label} · ×${batch.reveals.length}`;
    gsap.fromTo(this.el, { opacity: 0 }, { opacity: 1, duration: 0.3 });
    gsap.fromTo(this.cab, { scale: 0.35, y: 160, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: 0.75, ease: 'back.out(1.5)' });
    gsap.from(this.el.querySelector('.vs-top')!, { y: -60, opacity: 0, duration: 0.5, delay: 0.2, ease: 'back.out(2)' });
    await this.pause(700);

    // rattle + charge
    const cc = () => center(this.cab.querySelector('.cab-svg')!);
    audio.rattle(8);
    audio.charge(1.1 + best * 0.4);
    loop('vault:jig', this.cab, () => gsap.to(this.cab, { rotation: 2.2, x: 2, duration: 0.05, yoyo: true, repeat: -1, ease: 'none' }), { rotation: 0, x: 0 });
    const c0 = cc();
    particles.implode(c0.x, c0.y, 26, 'sparkWhite', 280);
    await this.pause(650);

    // escalation: the seam light climbs through the rarity colours
    for (let i = 0; i <= best; i++) {
      if (this.skipped) break;
      this.setTone(i, 0.45 + i * 0.14);
      audio.rarityStep(i);
      if (i) audio.rattle(3 + i);
      shake(0.12 + i * 0.08);
      punch(0.008 + i * 0.006);
      const c = cc();
      particles.implode(c.x, c.y, 14 + i * 9, SPARK[i], 320);
      flash(RARITIES[i].color, 0.1 + i * 0.05);
      gsap.fromTo(this.cab.querySelector('.cab-seam'), { opacity: 0.6 }, { opacity: 1, duration: 0.3 });
      await this.pause(i >= 3 ? 720 : 460);
    }
    stopLoop('vault:jig');
    if (best >= 3 && !this.skipped) {
      // held breath before the big one
      gsap.to(this.cab, { y: -18, scale: 1.06, duration: 0.55, ease: 'power2.out' });
      loop('vault:tremble', this.cab, () => gsap.to(this.cab, { x: 3, duration: 0.03, yoyo: true, repeat: -1 }), { x: 0 });
      audio.charge(0.6);
      await this.pause(620);
      stopLoop('vault:tremble');
    }
    this.burst(best);
    await wait(this.skipped ? 350 : 950);
    // the cabinet sinks out of frame; cards rise from where it went
    gsap.to(this.cab, { y: innerHeight * 0.6, scale: 0.6, opacity: 0, duration: 0.6, ease: 'power3.in' });
    await fonts;

    const n = batch.reveals.length;
    for (let i = 0; i < n && !this.skipped && !this.closed; i++) await this.revealOne(i);
    if (this.closed) return;
    if (n > 1 || this.skipped) this.summary();
  }

  private burst(best: number) {
    const svg = this.cab.querySelector('.cab-svg')!;
    const c = center(svg);
    const R = RARITIES[best];
    this.setTone(best, 1);
    gsap.set(this.cab, { y: 0, scale: 1 });
    this.o.machine.open(svg);
    gsap.fromTo(this.rays, { scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, ease: 'power3.out' });
    this.el.classList.add('open');
    flash('#ffffff', 0.9, 0.6);
    shake(0.5 + best * 0.1);
    punch(0.04);
    audio.vaultOpen(best);
    particles.ring(c.x, c.y, 260, '#fff', 6, 0.55);
    particles.ring(c.x, c.y, 400, R.color, 3, 0.8);
    particles.burst(c.x, c.y, { count: 40 + best * 12, sprite: SPARK[best], speed: [400, 1100], size: [14, 28], g: 300, drag: 2, life: [0.5, 1], add: true, stretch: true });
    particles.burst(c.x, c.y, { count: 22, sprite: ['coin', 'coin', 'yuanbao'], speed: [500, 1200], size: [22, 34], g: 1500, drag: 0.8, life: [1, 1.6], angle: -Math.PI / 2, spread: 2.4, spin: true });
    particles.burst(c.x, c.y, { count: 20, sprite: 'goldLeaf', speed: [200, 700], size: [10, 22], g: 220, drag: 1.5, life: [1.4, 2.4], spin: true });
    particles.burst(c.x, c.y, { count: 12, sprite: 'ink', speed: [400, 900], size: [12, 26], g: 1300, drag: 1, life: [0.7, 1.1] });
    particles.burst(c.x, c.y, { count: 14, sprite: 'paper', speed: [300, 800], size: [16, 28], g: 1400, life: [0.8, 1.2] });
    if (best >= 2) particles.confetti(60 + best * 30, false);
  }

  private async revealOne(i: number) {
    const { batch } = this.o;
    const p = batch.reveals[i];
    const R = RARITIES[p.rarity];
    const n = batch.reveals.length;
    this.counter.textContent = `${i + 1} / ${n}`;
    pop(this.counter, 0.5);
    this.info.replaceChildren();

    const card = gcard(this.cardW, p.rarity, batch.back?.(this.cardW) ?? cardBack(this.cardW), false);
    this.card = card;
    card.el.classList.add('down');
    this.slot.append(card.el);
    this.setTone(p.rarity, 0.35 + p.rarity * 0.12);
    const to = center(this.slot);
    const from = { x: innerWidth / 2, y: innerHeight + this.cardW * 0.4 };
    audio.swoosh();
    particles.burst(to.x, innerHeight - 20, { count: 10 + p.rarity * 4, sprite: SPARK[p.rarity], speed: [300, 700], size: [12, 22], g: 200, drag: 2, life: [0.4, 0.8], add: true, angle: -Math.PI / 2, spread: 1.4, stretch: true });
    gsap.fromTo(card.el, { x: from.x - to.x, y: from.y - to.y, scale: 0.15, rotation: rand(-40, 40) }, { x: 0, y: 0, scale: 1, rotation: 0, duration: 0.6, ease: 'back.out(1.3)' });
    loop('vault:breathe', card.el, () => gsap.to(card.el, { y: -8, duration: 1.1, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 0.6 }), { y: 0 });
    await this.pause(480);
    if (!this.skipped) this.showHint(t('tapReveal'));
    await this.waitTap();
    this.hideHint();
    if (this.skipped) {
      stopLoop('vault:breathe');
      card.destroy();
      this.card = null;
      return;
    }

    // suspense for the big ones
    if (p.rarity >= 3) {
      audio.charge(0.7);
      loop('vault:shiver', card.el, () => gsap.to(card.el, { rotation: 1.6, duration: 0.04, yoyo: true, repeat: -1 }), { rotation: 0 });
      card.el.classList.add('charging');
      const c = center(card.body);
      particles.implode(c.x, c.y, 30, SPARK[p.rarity], 240);
      await wait(700);
      stopLoop('vault:shiver');
      card.el.classList.remove('charging');
    }
    stopLoop('vault:breathe');

    const front = p.paint(this.cardW);
    card.flatten();
    card.el.classList.add('busy');
    await flipper.flip({ el: card.body, front, back: card.cv, from: Math.PI, to: Math.PI * 2, duration: 0.72, hop: 50, onMid: () => audio.pop(0.8) });
    if (this.closed) return;
    card.setFace(front, true);
    card.el.classList.remove('busy', 'down');
    this.repaint = () => card.setFace(p.paint(this.cardW), true);
    const layer = p.layer?.();
    if (layer) {
      card.body.insertBefore(layer, card.cv.nextSibling);
      gsap.fromTo(layer, { scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(2.2)' });
    }
    const r = card.body.getBoundingClientRect();
    revealFx(p.rarity, r.left + r.width / 2, r.top + r.height / 2, r.width, r.height, R.color);
    audio.reveal(p.rarity);
    p.shown?.();
    pop(card.el, 0.35);
    this.showInfo(i);

    if (n === 1 && !this.skipped) {
      gsap.to(this.skipBtn, { opacity: 0, duration: 0.2, onComplete: () => (this.skipBtn.style.visibility = 'hidden') });
      const extra = p.extra?.();
      if (extra) {
        // pinned to the card's lower edge, so the info lines and the buttons keep their room
        card.el.append(extra);
        gsap.from(extra, { scale: 0, duration: 0.45, delay: 0.3, ease: 'back.out(2)' });
      }
      this.actions(this.info);
      return;
    }
    await this.pause(350);
    if (!this.skipped) this.showHint(i < n - 1 ? t('tapNext') : t('done'));
    await this.waitTap();
    this.hideHint();
    this.info.replaceChildren();
    audio.swoosh();
    this.repaint = null;
    gsap.to(card.el, { y: -innerHeight * 0.55, x: rand(-90, 90), rotation: rand(-25, 25), scale: 0.4, opacity: 0, duration: 0.42, ease: 'power2.in', onComplete: () => card.destroy() });
    this.card = null;
  }

  private showInfo(i: number) {
    const p = this.o.batch.reveals[i];
    const R = RARITIES[p.rarity];
    const name = h('span', { class: 'vs-rn' }, ...[...R.name].map((ch) => h('i', null, ch)));
    const tag = p.isNew
      ? h('span', { class: 'vs-tag new' }, tx('newCard'), '!')
      : h('span', { class: 'vs-tag dup' }, tx('duplicate'), ` ×${p.copies}`, p.refund ? h('span', { class: 'vs-refund' }, ` +${p.refund}`, h('span', { class: 'mini-coin', html: this.o.price.icon })) : null);
    const row = h('div', { class: 'vs-rarity', 'data-r': String(p.rarity) }, h('span', { class: 'vs-rz' }, R.zh), name, tag);
    this.info.append(row);
    gsap.fromTo(name.children, { scale: 2.4, opacity: 0, y: -10 }, { scale: 1, opacity: 1, y: 0, duration: 0.4, stagger: 0.035, ease: 'back.out(3)' });
    gsap.fromTo(row.querySelector('.vs-rz'), { scale: 0, rotation: -30 }, { scale: 1, rotation: -6, duration: 0.6, ease: 'elastic.out(1.1,0.5)' });
    gsap.fromTo(tag, { scale: 0 }, { scale: 1, duration: 0.5, delay: 0.25, ease: 'elastic.out(1.2,0.5)' });
  }

  /** again / done buttons */
  private actions(parent: HTMLElement) {
    const { qty, price } = this.o;
    const again = h('button', { class: 'big-btn vs-again', style: '--c:#e8344e' }, h('span', { class: 'big-btn-label' }, tx('again'), ` ×${qty}`), h('span', { class: 'price-tag' }, h('span', { class: 'mini-coin', html: price.icon }), formatNum(price.amount)));
    const done = h('button', { class: 'big-btn vs-done', style: '--c:#6b5a78' }, h('span', { class: 'big-btn-label' }, tx('done')));
    let pending = false;
    const settle = (next: AgainResult) => {
      if (typeof next === 'string') {
        audio.wrong();
        nope(again);
        if (next === 'poor') again.classList.add('poor');
        return;
      }
      audio.pop(1.2);
      this.celebrateMeta();
      this.destroy();
      new Opening({ ...this.o, batch: next });
    };
    pressable(again, () => {
      if (pending || this.closed) return;
      const next = this.o.again();
      if (!(next instanceof Promise)) return settle(next);
      // a purchase over the network: hold the stage, block Done, and let the caller explain a failure
      pending = true;
      again.classList.add('is-pending');
      done.classList.add('is-off');
      next
        .catch((): AgainResult => 'failed')
        .then((r) => {
          pending = false;
          again.classList.remove('is-pending');
          done.classList.remove('is-off');
          if (!this.closed) settle(r);
        });
    });
    pressable(done, () => {
      if (pending) return nope(done);
      audio.pop(0.9);
      this.close();
    });
    const row = h('div', { class: 'vs-actions' }, done, again);
    parent.append(row);
    gsap.from(row.children, { y: 60, opacity: 0, duration: 0.5, stagger: 0.08, delay: 0.4, ease: 'back.out(1.8)' });
  }

  private summary() {
    const { batch } = this.o;
    this.hideHint();
    this.info.replaceChildren();
    this.card?.destroy();
    this.card = null;
    gsap.to(this.skipBtn, { opacity: 0, duration: 0.2 });
    gsap.to(this.cab, { opacity: 0, duration: 0.4 });
    this.counter.textContent = '';
    const best = batch.best;
    this.setTone(best, 0.5);

    const counts = RARITIES.map((R) => batch.reveals.filter((p) => p.rarity === R.i).length);
    const chips = RARITIES.filter((R) => counts[R.i]).reverse().map((R) => h('span', { class: 'tier-chip', 'data-r': String(R.i) }, R.name, h('b', null, `×${counts[R.i]}`)));
    const fresh = batch.reveals.filter((p) => p.isNew).length;
    const tiles = batch.reveals.map((p) => p.tile());
    const refund = batch.reveals.reduce((s, p) => s + p.refund, 0);
    this.sum.replaceChildren(
      h('div', { class: 'sum-head' },
        h('h2', { class: 'sum-title' }, '收获'),
        h('div', { class: 'sum-sub' }, `${batch.label} · ${fresh} `, tx('newCard'), refund ? ` · +${refund}` : '', refund ? h('span', { class: 'mini-coin', html: this.o.price.icon }) : null),
        h('div', { class: 'sum-chips' }, ...chips)),
      h('div', { class: 'sum-grid' }, ...tiles),
    );
    this.sum.classList.add('show');
    this.actions(this.sum);
    gsap.fromTo(this.sum.querySelector('.sum-head'), { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'back.out(2)' });
    tiles.forEach((m, i) => {
      const r = batch.reveals[i].rarity;
      gsap.fromTo(m, { scale: 0, rotation: rand(-20, 20) }, {
        scale: 1, rotation: 0, duration: 0.6, delay: 0.15 + i * 0.07, ease: 'elastic.out(1.1,0.55)',
        onStart: () => {
          audio.pop(0.9 + r * 0.12 + i * 0.02);
          if (r >= 2) {
            const c = center(m);
            particles.burst(c.x, c.y, { count: 6 + r * 4, sprite: SPARK[r], speed: [120, 320], size: [10, 18], g: 0, drag: 3, life: [0.3, 0.6], add: true });
          }
        },
      });
    });
  }

  /** titles earned by this batch (shown once the stage is gone). Level only grows from playing games. */
  private celebrateMeta() {
    announceTitles(this.o.batch.titles ?? [], 0.4);
  }

  private close() {
    if (this.closed) return;
    this.closed = true;
    gsap.to(this.el, { opacity: 0, duration: 0.35, onComplete: () => this.destroy() });
    this.celebrateMeta();
    this.o.onClose();
  }

  destroy() {
    this.closed = true;
    this.offLang();
    if (Opening.current === this) Opening.current = null;
    stopAllLoops('vault:');
    this.card?.destroy();
    this.el.remove();
  }
}
