/**
 * Cloze Rush — an example sentence is built from ink-brush glyph tiles with one glowing gap.
 * Pick the hanzi that belongs there: the tile flies out of the button in an arc and lands in the slot.
 * Right → the slot stamps green, a light wave runs through the sentence, pinyin writes itself in and a
 * red seal (对 · 好 · 绝 · 神 as the combo grows) slams down. Wrong → the tile is rejected and falls away,
 * and the true word is brushed into the gap in gold.
 *
 * All scoring / combo / FEVER / hearts / timer logic is inherited from the Meaning Rush engine (QuizGame);
 * this class only owns the sentence card, the choices and the flight.
 */
import gsap from 'gsap';
import type { Word } from '../../core/data';
import type { ThemeName } from '../../engine/background';
import { h, center, rand, shuffle, lerp, wait } from '../../core/util';
import { i18n, tx } from '../../core/i18n';
import { store } from '../../core/store';
import { audio, speak } from '../../engine/audio';
import { particles } from '../../engine/particles';
import { shake, punch } from '../../engine/shake';
import { pop, nope } from '../../engine/juice';
import { QuizGame } from '../quiz/QuizGame';
import { F_HANZI } from '../quiz/cardFace';
import type { GameContext } from '../registry';
import type { Screen } from '../../core/app';

const INK = '#2a1a3a';
const PUNCT = /[\p{P}\p{S}\s]/u;

export function create(ctx: GameContext): Screen {
  // every entry whose own word appears in its example sentence can be turned into a cloze
  const words = ctx.words.filter((w) => w.ex.zh.includes(w.h));
  return new ClozeGame({ ...ctx, words }).init();
}

class ClozeGame extends QuizGame {
  private sent!: HTMLElement;
  private pyLine!: HTMLElement;
  private hint!: HTMLElement;
  private shine!: HTMLElement;
  private seal!: HTMLElement;
  private slot!: HTMLElement;
  private fill!: HTMLElement;
  private fpy!: HTMLElement;
  private fs = 40;
  private exploded = true;
  private canSkip = false;

  constructor(ctx: GameContext) {
    super(ctx);
    // reading a sentence takes longer than glancing at a hanzi
    this.timeMax += 5;
  }

  protected get gid() {
    return 'cloze';
  }
  protected get baseTheme(): ThemeName {
    return 'jade';
  }
  protected get explodeDelay() {
    return 1.35;
  }

  init(): Screen {
    const screen = super.init();
    this.el.classList.add('cloze');

    this.sent = h('div', { class: 'cz-sent' });
    this.pyLine = h('div', { class: 'cz-py' });
    this.hint = h('div', { class: 'cz-hint' });
    this.shine = h('div', { class: 'cz-shine' });
    this.seal = h('div', { class: 'cz-seal' }, '对');

    this.cardEl.classList.add('cz-card');
    this.cardEl.replaceChildren(
      h('div', { class: 'cz-clip' }, this.shine),
      h('div', { class: 'cz-ribbon' }, tx('clozeRibbon')),
      this.sent,
      this.pyLine,
      h('div', { class: 'cz-div' }),
      this.hint,
      this.seal,
    );

    // tap anywhere to skip the victory lap
    this.el.addEventListener('pointerup', (e) => {
      if (this.phase === 'lock' && this.canSkip && !(e.target as HTMLElement).closest('.topbar, .modal')) this.explodeCard();
    });
    return screen;
  }

  // ------------------------------------------------------------------ layout
  protected layoutCard() {
    const wrap = this.cardEl.parentElement!;
    const w = Math.min(wrap.clientWidth, 440);
    const avail = (this.el.querySelector('.stage-area') as HTMLElement).clientHeight - 70;
    this.cardW = Math.round(w);
    this.cardH = Math.round(Math.max(206, Math.min(avail, 330)));
    this.cardEl.style.width = `${this.cardW}px`;
    this.cardEl.style.height = `${this.cardH}px`;
  }

  /** the paper is empty while the countdown runs */
  protected introCard() {}

  // ------------------------------------------------------------------ question
  protected async presentQuestion(_fromReveal: boolean) {
    const w = this.word;
    await Promise.race([
      document.fonts.load(`900 40px ${F_HANZI}`, w.ex.zh + w.h + w.p + w.ex.py),
      new Promise((r) => setTimeout(r, 1200)),
    ]);
    if (this.isOver()) return;

    this.exploded = false;
    this.canSkip = false;
    this.cardEl.classList.remove('ok', 'bad', 'reveal');
    this.cardEl.dataset.heat = String(this.fever ? 5 : this.stage);
    this.cardEl.setAttribute('aria-label', w.ex.zh);
    gsap.set(this.seal, { opacity: 0 });
    gsap.set(this.shine, { x: -200 });

    // ---- build the sentence: [glyph tiles] [slot] [glyph tiles]; punctuation sticks to the tile before it
    const i = w.ex.zh.indexOf(w.h);
    const before = [...w.ex.zh.slice(0, i)];
    const after = [...w.ex.zh.slice(i + w.h.length)];
    const n = [...w.h].length;

    this.sent.replaceChildren();
    let last: HTMLElement | null = null;
    const addChar = (ch: string) => {
      if (PUNCT.test(ch) && last) {
        last.append(h('span', { class: 'cz-p' }, ch));
        return;
      }
      last = h('span', { class: 'cz-g' }, h('span', { class: PUNCT.test(ch) ? 'cz-p' : 'cz-c' }, ch));
      this.sent.append(last);
    };
    before.forEach(addChar);

    this.fill = h('span', { class: 'cz-fill' });
    this.fpy = h('span', { class: 'cz-fpy' }, w.p);
    this.slot = h('span', { class: 'cz-slot', style: `--n:${n}` }, h('span', { class: 'cz-q' }, '?'), this.fill, this.fpy);
    last = h('span', { class: 'cz-g' }, this.slot);
    this.sent.append(last);
    after.forEach(addChar);

    this.pyLine.textContent = w.ex.py;
    gsap.set(this.pyLine, { opacity: 0 });
    this.renderHint();

    // ---- fit: biggest glyphs that keep the sentence inside its box
    let fs = Math.min(64, Math.round(this.cardW * 0.155));
    for (; fs > 20; fs -= 2) {
      this.sent.style.setProperty('--fs', `${fs}px`);
      if (this.sent.scrollHeight <= this.sent.clientHeight + 1 && this.sent.scrollWidth <= this.sent.clientWidth + 1) break;
    }
    this.fs = fs;

    // ---- entrance
    const glyphs = [...this.sent.querySelectorAll<HTMLElement>('.cz-c, .cz-p')];
    gsap.set(glyphs, { opacity: 0 });
    gsap.set(this.slot, { scale: 0 });
    gsap.set(this.hint, { opacity: 0 });
    audio.whoosh();
    pop(this.cardEl, 0.35);
    const tl = gsap.timeline();
    tl.fromTo(
      glyphs,
      { y: -56, scaleY: 1.4, scaleX: 0.75, rotation: () => rand(-10, 10), opacity: 0 },
      { y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, duration: 0.55, stagger: 0.035, ease: 'back.out(2.4)' },
      0.05,
    );
    const slotAt = 0.05 + Math.min(glyphs.length, 14) * 0.035 * 0.7;
    tl.fromTo(this.slot, { scale: 0, rotation: -14 }, { scale: 1, rotation: 0, duration: 0.7, ease: 'elastic.out(1.15,0.42)' }, slotAt);
    tl.fromTo(this.hint, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'power2.out' }, slotAt + 0.15);
    tl.call(
      () => {
        if (this.isOver()) return;
        const c = center(this.slot);
        particles.ring(c.x, c.y, 90, '#ffe08a', 8, 0.5);
        particles.burst(c.x, c.y, { count: 8, sprite: 'sparkGold', speed: [80, 260], size: [10, 20], g: 0, drag: 3, life: [0.3, 0.6], add: true });
        audio.pop(1.3);
      },
      [],
      slotAt + 0.05,
    );
    for (let k = 0; k < Math.min(glyphs.length, 12); k += 3) tl.call(() => audio.pop(0.7 + k * 0.04), [], 0.08 + k * 0.035);

    await wait(Math.round((slotAt + 0.35) * 1000));
  }

  private renderHint() {
    const th = i18n.lang === 'th';
    this.hint.textContent = th ? this.word.ex.th : this.word.ex.en;
    this.hint.classList.toggle('th', th);
  }

  protected onLangChange() {
    this.renderLabels();
    if (this.word) this.renderHint();
  }

  // ------------------------------------------------------------------ choices
  protected renderLabels() {
    this.choices.forEach((w, i) => {
      const len = [...w.h].length;
      const L = this.labels[i];
      L.className = `ch-label hz ${len > 4 ? 'xs' : len > 2 ? 's' : ''}`;
      L.replaceChildren(h('span', { class: 'hz-h' }, w.h), ...(store.settings.pinyin ? [h('span', { class: 'hz-p' }, w.p)] : []));
    });
  }

  /** distractors: never a word already in the sentence, never a substring of the answer; same length first */
  protected pickChoices(answer: Word): Word[] {
    const pool = this.ctx.words;
    const len = [...answer.h].length;
    const out: Word[] = [];
    const seen = new Set([answer.h]);
    const ok = (w: Word) => !seen.has(w.h) && !answer.ex.zh.includes(w.h) && !answer.h.includes(w.h) && !w.h.includes(answer.h);
    for (const strict of [true, false]) {
      for (let g = 0; g < 500 && out.length < 3; g++) {
        const w = pool[Math.floor(Math.random() * pool.length)];
        if (!ok(w) || (strict && [...w.h].length !== len)) continue;
        seen.add(w.h);
        out.push(w);
      }
    }
    return shuffle([answer, ...out]);
  }

  // ------------------------------------------------------------------ answering: the flight
  protected answer(i: number) {
    if (this.phase !== 'ask' || this.paused) return;
    this.phase = 'lock';
    this.stopUrgency();
    const ok = i === this.answerIdx;
    store.recordWord(this.word.h, ok);
    const btn = this.buttons[i];
    pop(btn, 0.7);
    audio.whoosh();
    this.fly(i).then(() => {
      if (this.isOver()) return;
      if (ok) this.onCorrect(btn);
      else this.onWrong(btn);
    });
  }

  /** the chosen word lifts off its button, arcs over the card and thuds into the slot */
  private fly(i: number): Promise<void> {
    return new Promise((resolve) => {
      const w = this.choices[i];
      const label = this.labels[i].firstElementChild as HTMLElement;
      const from = center(label);
      const to = center(this.slot);
      const s0 = parseFloat(getComputedStyle(label).fontSize) / this.fs;
      const tile = h('div', { class: 'cz-fly' }, w.h);
      tile.style.fontSize = `${this.fs}px`;
      document.getElementById('overlay')!.append(tile);
      label.style.visibility = 'hidden';

      const side = from.x < to.x ? -1 : 1;
      const cx = (from.x + to.x) / 2 + side * rand(40, 110);
      const cy = Math.min(from.y, to.y) - rand(110, 170);
      const p = { t: 0 };
      let trail = 0;
      const place = (t: number) => {
        const u = 1 - t;
        const x = u * u * from.x + 2 * u * t * cx + t * t * to.x;
        const y = u * u * from.y + 2 * u * t * cy + t * t * to.y;
        const sc = lerp(s0, 1, Math.min(1, t * 1.6)) * (1 + Math.sin(t * Math.PI) * 0.22);
        tile.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) scale(${sc}) rotate(${Math.sin(t * Math.PI * 2) * -14}deg)`;
        return { x, y };
      };
      place(0);
      gsap.to(p, {
        t: 1,
        duration: 0.46,
        ease: 'power2.in',
        onUpdate: () => {
          const { x, y } = place(p.t);
          if (trail++ % 2 === 0) particles.burst(x, y, { count: 1, sprite: 'sparkGold', speed: [10, 60], size: [12, 22], g: 0, drag: 2, life: [0.25, 0.45], add: true });
        },
        onComplete: () => {
          tile.remove();
          label.style.visibility = '';
          this.land(w);
          resolve();
        },
      });
    });
  }

  private land(w: Word) {
    const c = center(this.slot);
    this.fill.textContent = w.h;
    this.slot.classList.add('filled');
    gsap.fromTo(this.fill, { opacity: 1, scale: 1.55 }, { opacity: 1, scale: 1, duration: 0.36, ease: 'back.out(3.5)' });
    gsap.fromTo(this.slot, { scaleX: 1.22, scaleY: 0.78 }, { scaleX: 1, scaleY: 1, duration: 0.6, ease: 'elastic.out(1.2,0.35)' });
    gsap.to(this.sent, { y: 5, duration: 0.07, yoyo: true, repeat: 1, ease: 'power2.out' });
    particles.ring(c.x, c.y, 110, '#fff', 10, 0.4);
    particles.burst(c.x, c.y, { count: 8, sprite: 'puff', speed: [60, 200], size: [24, 40], shrink: 0.1, g: -60, drag: 3, life: [0.3, 0.5] });
    audio.pop(0.55);
    shake(0.14);
  }

  // ------------------------------------------------------------------ correct
  protected speakAnswer() {
    speak(this.word.ex.zh);
  }

  protected celebrateCard() {
    const cc = center(this.cardEl);
    this.cardEl.classList.add('ok');
    gsap.fromTo(this.rays, { scale: 0.3, opacity: 1, rotation: 0 }, { scale: 1.5, opacity: 0, rotation: 120, duration: 1, ease: 'power2.out' });
    pop(this.cardEl, 0.5);
    particles.burst(cc.x, cc.y - this.cardH * 0.1, { count: 8, sprite: 'glow', speed: [40, 140], size: [70, 120], g: 0, life: [0.4, 0.7], add: true });

    // pinyin of the word writes itself in above the slot, whole-sentence pinyin below
    gsap.fromTo(this.fpy, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, delay: 0.1, ease: 'back.out(2.5)' });
    gsap.fromTo(this.pyLine, { opacity: 0, y: 8, letterSpacing: '4px' }, { opacity: 1, y: 0, letterSpacing: '0.3px', duration: 0.6, delay: 0.45, ease: 'power2.out' });
    this.wave();
    gsap.fromTo(this.shine, { x: -200 }, { x: this.cardW + 320, duration: 0.8, delay: 0.1, ease: 'power2.inOut' });

    // the seal: bigger praise glyph as the combo climbs
    this.seal.textContent = this.combo >= 20 ? '神' : this.combo >= 10 ? '绝' : this.combo >= 5 ? '好' : '对';
    const sr = this.slot.getBoundingClientRect();
    const cr = this.cardEl.getBoundingClientRect();
    this.seal.style.left = `${sr.right - cr.left - 22}px`;
    this.seal.style.top = `${sr.top - cr.top - 30}px`;
    gsap
      .timeline({ delay: 0.2 })
      .fromTo(this.seal, { scale: 3.4, opacity: 0, rotation: -34 }, { scale: 1, opacity: 1, rotation: -12, duration: 0.24, ease: 'power4.in' })
      .add(() => {
        if (this.isOver()) return;
        const sc = center(this.seal);
        particles.burst(sc.x, sc.y, { count: 12, sprite: ['ink', 'sparkRed'], speed: [120, 380], size: [14, 28], g: 600, life: [0.4, 0.8] });
        particles.ring(sc.x, sc.y, 130, '#ff4757', 10, 0.4);
        audio.boom(0.4);
        shake(0.3);
        punch(0.02);
        gsap.fromTo(this.cardEl, { y: 5 }, { y: 0, duration: 0.5, ease: 'elastic.out(1.3,0.3)' });
        this.canSkip = true;
      })
      .to(this.seal, { scale: 1.08, rotation: -9, duration: 0.5, ease: 'elastic.out(1,0.3)' });
  }

  /** a ripple of light runs left→right through the sentence */
  private wave() {
    const els = [...this.sent.querySelectorAll<HTMLElement>('.cz-c, .cz-p')];
    els.forEach((el, i) => {
      const d = 0.1 + i * 0.04;
      gsap
        .timeline({ delay: d })
        .fromTo(el, { color: '#ff9a1f' }, { color: INK, duration: 0.6, ease: 'power1.out' }, 0)
        .to(el, { y: -14, scaleY: 1.12, duration: 0.1, ease: 'power2.out' }, 0)
        .to(el, { y: 0, scaleY: 1, duration: 0.6, ease: 'elastic.out(1.3,0.35)' }, 0.1);
      if (i % 2 === 0) {
        gsap.delayedCall(d, () => {
          if (this.isOver()) return;
          const c = center(el);
          particles.burst(c.x, c.y - 10, { count: 2, sprite: 'sparkGold', speed: [40, 150], size: [10, 20], g: 220, life: [0.3, 0.6], add: true });
        });
      }
    });
  }

  /** the sentence tiles tumble away; the paper stays for the next question */
  protected explodeCard() {
    if (this.isOver() || this.exploded) return;
    this.exploded = true;
    this.canSkip = false;
    const items = [...this.sent.querySelectorAll<HTMLElement>('.cz-g')];
    const cc = center(this.cardEl);
    audio.swoosh();
    gsap
      .timeline()
      .to(items, { y: -34, opacity: 0, scale: 0.6, rotation: () => rand(-24, 24), duration: 0.28, stagger: 0.02, ease: 'power2.in' }, 0)
      .to([this.pyLine, this.hint, this.seal], { opacity: 0, y: -10, duration: 0.2 }, 0)
      .add(() => {
        particles.burst(cc.x, cc.y, { count: 12, sprite: ['paper', 'puff'], speed: [200, 560], size: [20, 34], g: 1500, life: [0.5, 0.9] });
        audio.boom(0.3);
        this.next(false);
      }, '>-0.05');
    gsap.to(this.buttons, { scale: 0, duration: 0.2, stagger: 0.03, ease: 'back.in(2)' });
  }

  // ------------------------------------------------------------------ wrong
  protected revealAnswer(timeout: boolean) {
    const w = this.word;
    this.cardEl.classList.add('bad');
    gsap.delayedCall(timeout ? 0.25 : 0.4, () => {
      if (this.isOver()) return;
      nope(this.slot);
      // the wrong tile drops out of the gap
      if (!timeout) {
        const c = center(this.fill);
        const ghost = h('div', { class: 'cz-fly dead' }, this.fill.textContent);
        ghost.style.fontSize = `${this.fs}px`;
        ghost.style.transform = `translate(${c.x}px,${c.y}px) translate(-50%,-50%)`;
        document.getElementById('overlay')!.append(ghost);
        this.fill.style.opacity = '0';
        gsap.to(ghost, { y: 260, x: `+=${rand(-60, 60)}`, rotation: rand(-50, 50), opacity: 0, duration: 0.7, ease: 'power2.in', onComplete: () => ghost.remove() });
        particles.burst(c.x, c.y, { count: 8, sprite: 'puff', speed: [80, 220], size: [20, 34], shrink: 0.1, g: -80, drag: 3, life: [0.3, 0.5] });
      }
      // the true word is brushed in, in gold
      gsap.delayedCall(timeout ? 0.1 : 0.5, () => {
        if (this.isOver()) return;
        this.cardEl.classList.remove('bad');
        this.cardEl.classList.add('reveal');
        this.slot.classList.add('filled');
        this.fill.textContent = w.h;
        gsap.fromTo(this.fill, { opacity: 1, clipPath: 'inset(0 100% 0 0)', scale: 1 }, { opacity: 1, clipPath: 'inset(0 0% 0 0)', duration: 0.55, ease: 'power2.out', onComplete: () => void (this.fill.style.clipPath = '') });
        gsap.fromTo(this.fpy, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, delay: 0.3, ease: 'back.out(2.5)' });
        gsap.fromTo(this.pyLine, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.5, delay: 0.5, ease: 'power2.out' });
        const c = center(this.slot);
        particles.burst(c.x, c.y, { count: 10, sprite: 'sparkGold', speed: [60, 240], size: [12, 22], g: 100, drag: 2.5, life: [0.4, 0.8], add: true });
        audio.bell(659, 0, 0.14);
        audio.bell(988, 0.09, 0.12);
        speak(w.ex.zh);
        gsap.delayedCall(0.7, () => !this.isOver() && this.showContinue());
      });
    });
  }
}
