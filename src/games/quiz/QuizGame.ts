/**
 * Meaning Rush — see a hanzi card, pick the meaning (TH/EN) from 4 choices.
 * Rush mode: 3 lives + per-question timer, endless. Practice (zen): 20 questions, no timer.
 * Escalation: combo → heat stages (music layers, background speed/colour, bigger FX) → FEVER.
 */
import gsap from 'gsap';
import type { Screen } from '../../core/app';
import { app } from '../../core/app';
import type { Word } from '../../core/data';
import { h, center, rand, shuffle, formatNum, pick, clamp } from '../../core/util';
import { t, tx, i18n, PRAISE } from '../../core/i18n';
import { store } from '../../core/store';
import { audio, speak } from '../../engine/audio';
import { particles } from '../../engine/particles';
import { background, type ThemeName } from '../../engine/background';
import { shake, punch } from '../../engine/shake';
import { flipper } from '../../engine/flip3d';
import { pop, pressable, nope, loop, stopLoop, breathe, stopAllLoops } from '../../engine/juice';
import { langToggle, muteButton, iconButton, ICON } from '../../ui/widgets';
import type { GameContext } from '../registry';
import { drawFront, drawPatternBack, drawAnswerBack, F_HANZI } from './cardFace';
import { resultsScreen, type RunStats } from '../../screens/results';
import { awardRun } from '../../core/meta';
import { cloud, type RunHandle } from '../../core/cloud';
import { boardKey, checkRun, type RankedGame } from '../../../shared/api';

type Phase = 'intro' | 'ask' | 'lock' | 'reveal' | 'over';

const STAGE_AT = [0, 5, 10, 20, 30];
const FEVER_TIME = 10;
const ZEN_TOTAL = 20;

export function create(ctx: GameContext): Screen {
  return new QuizGame(ctx).init();
}

export class QuizGame {
  screen!: Screen;
  protected ctx: GameContext;
  protected rush: boolean;
  protected phase: Phase = 'intro';
  protected paused = false;

  // run state
  protected score = 0;
  protected shown = { v: 0 };
  protected combo = 0;
  protected maxCombo = 0;
  protected correct = 0;
  protected asked = 0;
  protected lives = 3;
  protected stage = 0;
  protected feverGauge = 0;
  protected feverT = 0;
  protected fever = false;
  protected timeMax: number;
  protected timeLeft = 0;
  protected lastTick = 0;
  protected missed: Word[] = [];
  protected used = new Set<string>();
  protected retry: { w: Word; due: number }[] = [];
  protected word!: Word;
  protected choices: Word[] = [];
  protected answerIdx = 0;
  protected pointSfx = 0;

  // DOM
  protected el!: HTMLElement;
  protected cardEl!: HTMLElement;
  protected cardCv!: HTMLCanvasElement;
  protected rays!: HTMLElement;
  protected timerFill!: HTMLElement;
  protected timerEl!: HTMLElement;
  protected scoreEl!: HTMLElement;
  protected scorePill!: HTMLElement;
  protected hearts: HTMLElement[] = [];
  protected feverFill!: HTMLElement;
  protected feverRow!: HTMLElement;
  protected feverLabel!: HTMLElement;
  protected comboEl!: HTMLElement;
  protected comboNum!: HTMLElement;
  protected qMeta!: HTMLElement;
  protected buttons: HTMLButtonElement[] = [];
  protected labels: HTMLElement[] = [];
  protected contHint!: HTMLElement;
  protected pauseModal!: HTMLElement;
  protected cardW = 320;
  protected cardH = 220;
  protected offLang: () => void = () => {};
  /** cloud run ticket + clock for this run (leaderboard submission) */
  protected run?: RunHandle;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.rush = ctx.mode === 'rush';
    this.lives = this.rush ? 3 : Infinity;
    this.timeMax = 10 + (ctx.level >= 4 ? 2 : 0);
  }

  /** game id used for bests / results / retry */
  protected get gid() {
    return 'quiz';
  }
  /** resting backdrop colour world */
  protected get baseTheme(): ThemeName {
    return 'play';
  }

  /** two-phase construction: subclasses override hooks that touch their own fields after super() */
  init(): Screen {
    this.build();
    if (import.meta.env.DEV) (window as any).__quiz = this;
    this.screen = {
      el: this.el,
      theme: this.baseTheme,
      enter: () => this.start(),
      leave: () => this.teardown(),
      update: (dt) => this.update(dt),
      onKey: (e) => this.onKey(e),
      onHidden: () => this.phase !== 'over' && this.setPaused(true),
    };
    return this.screen;
  }

  /** method (not inline compare) so TS doesn't over-narrow `phase` across awaits */
  protected isOver() {
    return this.phase === 'over';
  }

  // ------------------------------------------------------------------ build
  protected build() {
    this.scoreEl = h('span', { class: 'score-v' }, '0');
    this.scorePill = h('div', { class: 'score-pill' }, h('span', { class: 'score-ic', html: ICON.blossom }), this.scoreEl);

    const lifeBox = h('div', { class: 'hearts' });
    if (this.rush) {
      for (let i = 0; i < 3; i++) {
        const hEl = h('span', { class: 'heart', html: ICON.heart });
        this.hearts.push(hEl);
        lifeBox.append(hEl);
      }
    } else {
      lifeBox.append(h('span', { class: 'zen-badge' }, tx('modeZen')));
    }

    const top = h(
      'div',
      { class: 'topbar game-top' },
      iconButton(ICON.pause, 'Pause', () => this.setPaused(true)),
      lifeBox,
      h('div', { class: 'spacer' }),
      muteButton(),
      langToggle(),
    );

    this.feverFill = h('div', { class: 'fever-fill' });
    this.feverLabel = h('span', { class: 'fever-label' }, tx('fever'));
    this.feverRow = h(
      'div',
      { class: 'fever-row' },
      this.scorePill,
      h('span', { class: 'fever-icon', html: ICON.flame }),
      h('div', { class: 'fever-bar' }, this.feverFill, this.feverLabel),
    );

    this.qMeta = h('div', { class: 'q-meta' });
    this.comboNum = h('span', { class: 'combo-n' }, '0');
    this.comboEl = h('div', { class: 'combo' }, h('span', { class: 'combo-x' }, '×'), this.comboNum, h('span', { class: 'combo-l' }, tx('combo')));

    this.cardCv = h('canvas', { class: 'card-cv' });
    this.cardEl = h('div', { class: 'card', role: 'img' }, this.cardCv);
    this.rays = h('div', { class: 'card-rays' });
    const cardWrap = h('div', { class: 'card-wrap' }, this.rays, this.cardEl, this.comboEl);

    this.timerFill = h('div', { class: 'timer-fill' });
    this.timerEl = h('div', { class: `timer ${this.rush ? '' : 'zen'}` }, this.timerFill);

    const choiceBox = h('div', { class: 'choices' });
    for (let i = 0; i < 4; i++) {
      const label = h('span', { class: 'ch-label' });
      const b = h('button', { class: `choice c${i}` }, h('span', { class: 'ch-key' }, String(i + 1)), label);
      pressable(b, () => this.answer(i));
      this.buttons.push(b);
      this.labels.push(label);
      choiceBox.append(b);
    }

    this.contHint = h('div', { class: 'continue' }, tx('tapContinue'), h('span', { class: 'cont-arrow' }, '▶'));

    this.pauseModal = h(
      'div',
      { class: 'modal hidden' },
      h(
        'div',
        { class: 'modal-card' },
        h('h2', { class: 'modal-title' }, tx('paused')),
        this.modalBtn('resume', '#5be35b', () => this.setPaused(false)),
        this.modalBtn('quit', '#ff4757', (e) => {
          this.phase = 'over';
          import('../../screens/levels').then(({ levelsScreen }) =>
            import('../registry').then(({ GAMES }) => app.go(() => levelsScreen(GAMES.find((g) => g.id === this.gid)!), { x: e.clientX, y: e.clientY })),
          );
        }),
      ),
    );

    this.el = h(
      'div',
      { class: 'screen quiz' },
      top,
      this.feverRow,
      h('div', { class: 'stage-area' }, this.qMeta, cardWrap, this.timerEl),
      choiceBox,
      this.contHint,
      this.pauseModal,
    );

    // tap anywhere to continue during reveal
    this.el.addEventListener('pointerup', (e) => {
      if (this.phase === 'reveal' && !(e.target as HTMLElement).closest('.topbar, .modal')) this.continue();
    });

    this.offLang = i18n.onChange(() => this.onLangChange());
  }

  protected onLangChange() {
    this.renderLabels();
    if (this.phase === 'reveal') this.drawAnswer(this.cardCv);
  }

  protected modalBtn(k: 'resume' | 'quit', color: string, onTap: (e: PointerEvent) => void) {
    const b = h('button', { class: 'big-btn', style: `--c:${color}` }, h('span', { class: 'big-btn-label' }, tx(k)));
    pressable(b, (e) => {
      audio.pop();
      onTap(e);
    });
    return b;
  }

  protected layoutCard() {
    const wrap = this.cardEl.parentElement!;
    const w = Math.min(wrap.clientWidth, 440);
    const avail = (this.el.querySelector('.stage-area') as HTMLElement).clientHeight - 70;
    this.cardW = Math.round(w);
    this.cardH = Math.round(clamp(Math.min(w * 0.78, avail), 190, 330));
    this.cardEl.style.width = `${this.cardW}px`;
    this.cardEl.style.height = `${this.cardH}px`;
  }

  // ------------------------------------------------------------------ flow
  protected async start() {
    this.run = cloud.startRun(boardKey(this.gid as RankedGame, this.ctx.level, this.ctx.mode));
    this.layoutCard();
    this.introCard();
    this.renderHud();
    this.buttons.forEach((b) => gsap.set(b, { scale: 0 }));
    gsap.set(this.comboEl, { scale: 0 });
    audio.setIntensity(0);
    audio.startMusic();
    background.speed.v = 0.12;
    gsap.from(this.el.querySelector('.game-top'), { y: -90, duration: 0.6, ease: 'back.out(1.8)' });
    gsap.from(this.feverRow, { y: -60, opacity: 0, duration: 0.6, delay: 0.1, ease: 'back.out(1.8)' });
    gsap.from(this.cardEl, { scale: 0, rotation: -20, duration: 0.8, delay: 0.1, ease: 'elastic.out(1,0.5)' });
    await this.countdown();
    if (this.isOver()) return;
    this.next(false);
  }

  protected async countdown() {
    const ov = document.getElementById('overlay')!;
    for (const n of [3, 2, 1, 0]) {
      if (this.isOver()) return;
      const txt = n ? String(n) : t('go');
      const el = h('div', { class: `countdown ${n ? '' : 'go'}` }, txt);
      ov.append(el);
      audio.countdown(n);
      shake(n ? 0.2 : 0.45);
      if (!n) {
        const c = center(this.cardEl);
        particles.firework(c.x, c.y - 40);
        particles.ring(c.x, c.y, 220, '#fff', 14);
      }
      gsap.timeline({ onComplete: () => el.remove() })
        .fromTo(el, { scale: 3, opacity: 0, rotation: n % 2 ? -12 : 12 }, { scale: 1, opacity: 1, rotation: 0, duration: 0.3, ease: 'back.out(2.5)' })
        .to(el, { scale: 0.6, opacity: 0, y: -40, duration: 0.25, delay: n ? 0.2 : 0.35, ease: 'power2.in' });
      await new Promise((r) => setTimeout(r, n ? 560 : 420));
    }
  }

  protected pickWord(): Word {
    const due = this.retry.findIndex((r) => r.due <= this.asked);
    if (due >= 0) return this.retry.splice(due, 1)[0].w;
    const pool = this.ctx.words;
    if (this.used.size >= pool.length - 4) this.used.clear();
    const stats = store.progress.words;
    // bias toward words the player hasn't mastered yet
    for (let tries = 0; tries < 40; tries++) {
      const w = pool[Math.floor(Math.random() * pool.length)];
      if (this.used.has(w.h) || (this.word && w.h === this.word.h)) continue;
      const s = stats[w.h];
      const mastery = s ? s[1] / Math.max(1, s[0]) : 0;
      if (s && s[0] >= 3 && mastery > 0.9 && Math.random() < 0.6) continue;
      return w;
    }
    return pick(pool.filter((w) => w.h !== this.word?.h));
  }

  protected pickChoices(answer: Word): Word[] {
    const pool = this.ctx.words;
    const taken = new Set([answer.en.toLowerCase(), answer.th]);
    const out: Word[] = [];
    let guard = 0;
    while (out.length < 3 && guard++ < 400) {
      const w = pool[Math.floor(Math.random() * pool.length)];
      if (w.h === answer.h || taken.has(w.en.toLowerCase()) || taken.has(w.th)) continue;
      taken.add(w.en.toLowerCase());
      taken.add(w.th);
      out.push(w);
    }
    return shuffle([answer, ...out]);
  }

  protected async next(fromReveal: boolean) {
    if (!this.rush && this.asked >= ZEN_TOTAL) return this.finish();
    this.phase = 'lock';
    this.word = this.pickWord();
    this.used.add(this.word.h);
    this.choices = this.pickChoices(this.word);
    this.answerIdx = this.choices.indexOf(this.word);
    this.asked++;
    this.qMeta.textContent = this.rush ? `${t('question')} ${this.asked}` : `${this.asked} / ${ZEN_TOTAL}`;

    this.buttons.forEach((b) => b.classList.remove('is-correct', 'is-wrong', 'is-dim'));
    this.renderLabels();
    await this.presentQuestion(fromReveal);
    if (this.isOver()) return;

    gsap.fromTo(
      this.buttons,
      { scale: 0, rotation: () => rand(-10, 10) },
      {
        scale: 1,
        rotation: 0,
        duration: 0.55,
        stagger: 0.05,
        ease: 'elastic.out(1.1,0.5)',
        onStart: () => [0, 1, 2, 3].forEach((i) => setTimeout(() => audio.pop(1 + i * 0.12), i * 50)),
      },
    );
    this.timeLeft = this.timeMax;
    this.lastTick = Math.ceil(this.timeMax);
    this.renderTimer();
    this.phase = 'ask';
  }

  /** card shown (face-down) while the countdown runs */
  protected introCard() {
    drawPatternBack(this.cardCv, this.cardW, this.cardH);
  }

  /** bring the new question onto the card. Base: WebGL flip to the hanzi face. */
  protected async presentQuestion(fromReveal: boolean) {
    // make sure the glyphs are loaded before painting to canvas (Google Fonts slices CJK by unicode-range)
    await Promise.race([
      document.fonts.load(`900 40px ${F_HANZI}`, this.word.h + this.word.ex.zh + this.word.p + this.word.ex.py),
      new Promise((r) => setTimeout(r, 1200)),
    ]);
    if (this.isOver()) return;

    const front = document.createElement('canvas');
    drawFront(front, this.cardW, this.cardH, this.word, store.settings.pinyin);
    const back = this.cardCv;
    if (!fromReveal) drawPatternBack(back, this.cardW, this.cardH);
    audio.whoosh();
    await flipper.flip({
      el: this.cardEl,
      front,
      back,
      from: Math.PI,
      to: Math.PI * 2,
      duration: 0.62,
      hop: 36,
      enterScale: fromReveal ? 1 : 0.2,
      onMid: () => audio.pop(0.8),
    });
    if (this.isOver()) return;
    this.cardEl.replaceChild(front, this.cardCv);
    front.className = 'card-cv';
    this.cardCv = front;
    this.cardEl.setAttribute('aria-label', `${this.word.h} ${this.word.p}`);
    pop(this.cardEl, 0.5);
  }

  protected renderLabels() {
    const lang = i18n.lang;
    this.choices.forEach((w, i) => {
      const text = lang === 'th' ? w.th : w.en;
      const L = this.labels[i];
      L.textContent = text;
      L.dataset.text = text;
      L.className = `ch-label ${lang === 'th' ? 'th' : ''} ${text.length > 18 ? 'xl' : text.length > 11 ? 'l' : ''}`;
    });
  }

  protected answer(i: number) {
    if (this.phase !== 'ask' || this.paused) return;
    this.phase = 'lock';
    this.stopUrgency();
    const ok = i === this.answerIdx;
    store.recordWord(this.word.h, ok);
    if (ok) this.onCorrect(this.buttons[i]);
    else this.onWrong(this.buttons[i]);
  }

  // ------------------------------------------------------------------ correct
  protected onCorrect(btn: HTMLButtonElement) {
    this.combo++;
    this.correct++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const frac = this.rush ? this.timeLeft / this.timeMax : 0;
    const base = 100 + (this.ctx.level - 1) * 20;
    const mult = 1 + Math.min(this.combo, 40) * 0.05;
    const pts = Math.round(((base + 100 * frac) * mult * (this.fever ? 2 : 1)) / 10) * 10;
    const prevScore = this.score;
    this.score += pts;

    btn.classList.add('is-correct');
    this.buttons.forEach((b) => b !== btn && b.classList.add('is-dim'));
    pop(btn, 1.3);
    audio.correct(this.combo);
    audio.cheer(this.combo);
    this.speakAnswer();

    const bc = center(btn);
    const power = 1 + this.stage * 0.35 + (this.fever ? 0.6 : 0);
    particles.ring(bc.x, bc.y, 120 * power, '#ffffff', 12);
    particles.burst(bc.x, bc.y, { count: 18 * power, sprite: this.fever ? 'sparkGold' : 'spark', speed: [300, 800], size: [14, 24], g: 400, drag: 3, life: [0.35, 0.7], add: true, stretch: true });
    particles.burst(bc.x, bc.y, { count: 6 * power, sprite: ['blossom', 'petalRed', 'petalRed'], speed: [200, 500], size: [18, 30], g: 1200, life: [0.6, 1] });
    this.pointSfx = 0;
    particles.treasure(
      bc.x,
      bc.y,
      () => center(this.scorePill),
      Math.round(6 + Math.min(this.combo, 16) + (this.fever ? 8 : 0)),
      () => {
        if (this.pointSfx++ % 2 === 0) audio.point(this.pointSfx);
        gsap.fromTo(this.scorePill, { scale: 1.12 }, { scale: 1, duration: 0.25, ease: 'back.out(3)', overwrite: true });
      },
      () => this.rollScore(prevScore, this.score),
      'points',
    );
    this.floatText(`+${formatNum(pts)}`, bc.x, bc.y - 20, this.fever ? 'gold' : '');

    this.celebrateCard();
    shake(0.18 + this.stage * 0.06);
    punch(0.012 + this.stage * 0.006);
    background.kick(power);
    this.flash('#fff', 0.25);

    // combo badge
    this.comboNum.textContent = String(this.combo);
    if (this.combo >= 2) {
      gsap.to(this.comboEl, { scale: 1, duration: 0.5, ease: 'elastic.out(1.2,0.4)' });
      pop(this.comboEl, 1.4);
    }
    this.comboEl.dataset.stage = String(this.stage);

    // praise
    const milestone = this.combo >= 3 && (this.combo === 3 || this.combo === 5 || this.combo % 5 === 0);
    if (milestone) this.praise();

    // heat stage
    const st = STAGE_AT.filter((s) => this.combo >= s).length - 1;
    if (st > this.stage) this.stageUp(st);

    // fever
    if (!this.fever) {
      this.feverGauge = Math.min(1, this.feverGauge + 0.1 + this.stage * 0.02);
      if (this.feverGauge >= 1) gsap.delayedCall(0.5, () => this.startFever());
    }
    this.renderHud();

    gsap.delayedCall(this.explodeDelay, () => this.explodeCard());
  }

  protected get explodeDelay() {
    return 0.8;
  }

  protected speakAnswer() {
    speak(this.word.h);
  }

  /** card-level reaction to a right answer (rays, squash, glow) */
  protected celebrateCard() {
    const cc = center(this.cardEl);
    gsap.fromTo(this.rays, { scale: 0.3, opacity: 1, rotation: 0 }, { scale: 1.5, opacity: 0, rotation: 120, duration: 0.9, ease: 'power2.out' });
    pop(this.cardEl, 0.6);
    particles.burst(cc.x, cc.y - this.cardH * 0.1, { count: 8, sprite: 'glow', speed: [40, 140], size: [60, 100], g: 0, life: [0.4, 0.6], add: true });
  }

  protected explodeCard() {
    if (this.isOver()) return;
    const cc = center(this.cardEl);
    gsap.timeline()
      .to(this.cardEl, { scaleX: 1.15, scaleY: 0.85, duration: 0.08, ease: 'power2.out' })
      .to(this.cardEl, { scale: 0, duration: 0.12, ease: 'power3.in' })
      .add(() => {
        particles.burst(cc.x, cc.y, { count: 14, sprite: 'paper', speed: [300, 700], size: [20, 34], g: 1600, life: [0.6, 1] });
        particles.burst(cc.x, cc.y, { count: 8, sprite: 'puff', speed: [80, 220], size: [30, 50], shrink: 0.1, g: -80, drag: 3, life: [0.4, 0.6] });
        audio.boom(0.35);
        gsap.set(this.cardEl, { scale: 1 });
        this.next(false);
      });
    gsap.to(this.buttons, { scale: 0, duration: 0.2, stagger: 0.03, ease: 'back.in(2)' });
  }

  protected rollScore(from: number, to: number) {
    this.shown.v = from;
    gsap.to(this.shown, {
      v: to,
      duration: 0.6,
      ease: 'power2.out',
      overwrite: true,
      onUpdate: () => (this.scoreEl.textContent = formatNum(this.shown.v)),
    });
  }

  protected praise() {
    const tier = this.combo >= 20 ? 4 : this.combo >= 15 ? 3 : this.combo >= 10 ? 2 : this.combo >= 5 ? 1 : 0;
    const p = PRAISE[tier];
    const ov = document.getElementById('overlay')!;
    const cc = center(this.cardEl);
    const el = h('div', { class: `praise t${tier}` }, h('span', { class: 'praise-zh' }, p.zh), h('span', { class: 'praise-main' }, p[i18n.lang]));
    el.style.top = `${cc.y - this.cardH / 2 - 10}px`;
    ov.append(el);
    gsap.timeline({ onComplete: () => el.remove() })
      .fromTo(el, { scale: 0, rotation: -18 }, { scale: 1, rotation: rand(-6, 6), duration: 0.5, ease: 'elastic.out(1.2,0.4)' })
      .to(el, { y: -50, opacity: 0, scale: 0.8, duration: 0.35, delay: 0.55, ease: 'power2.in' });
    particles.burst(innerWidth / 2, cc.y - this.cardH / 2, { count: 12, sprite: ['star', 'starPink'], speed: [200, 500], size: [16, 26], g: 800 });
    audio.firecracker(3 + tier);
  }

  protected stageUp(st: number) {
    this.stage = st;
    audio.stageUp(st);
    audio.setIntensity(st, this.fever);
    background.speed.v = 0.12 + st * 0.1;
    if (!this.fever) background.setTheme(st >= 2 ? 'hot' : this.baseTheme, 0.6);
    shake(0.4);
    for (let i = 0; i < 1 + st; i++) {
      gsap.delayedCall(i * 0.15, () => particles.firework(rand(innerWidth * 0.15, innerWidth * 0.85), rand(innerHeight * 0.12, innerHeight * 0.35), pick(['sparkGold', 'sparkRed', 'sparkCyan'] as const)));
    }
    if (st >= 2) loop('quiz:combo', this.comboEl, () => gsap.to(this.comboEl, { rotation: 4, duration: 0.18, yoyo: true, repeat: -1, ease: 'sine.inOut' }), { rotation: 0 });
  }

  // ------------------------------------------------------------------ fever
  protected startFever() {
    if (this.fever || this.isOver()) return;
    this.fever = true;
    this.feverT = FEVER_TIME;
    this.feverGauge = 1;
    audio.fever();
    audio.setIntensity(this.stage, true);
    background.setTheme('fever', 0.4);
    background.speed.v = 0.7;
    shake(0.8);
    punch(0.05);
    this.flash('#fff3b0', 0.7);
    particles.confetti(90);
    this.el.classList.add('is-fever');
    const ov = document.getElementById('overlay')!;
    const el = h('div', { class: 'fever-banner' }, h('span', { class: 'fb-zh' }, '发财啦!'), h('span', { class: 'fb-main' }, t('feverTime')), h('span', { class: 'fb-sub' }, '×2'));
    ov.append(el);
    gsap.timeline({ onComplete: () => el.remove() })
      .fromTo(el, { scale: 0, rotation: -25 }, { scale: 1, rotation: -4, duration: 0.7, ease: 'elastic.out(1.1,0.45)' })
      .to(el, { scale: 1.4, opacity: 0, duration: 0.35, delay: 0.8, ease: 'power2.in' });
    loop('quiz:fever', this.feverLabel, () => breathe(this.feverLabel, 0.12, 0.2), { scaleX: 1, scaleY: 1 });
    const fc = center(this.feverRow);
    particles.orbit(fc.x, fc.y, 18, fc.w * 0.45, 1.2);
  }

  protected endFever() {
    this.fever = false;
    this.feverGauge = 0;
    this.el.classList.remove('is-fever');
    stopLoop('quiz:fever');
    audio.setIntensity(this.stage, false);
    background.setTheme(this.stage >= 2 ? 'hot' : this.baseTheme, 0.8);
    background.speed.v = 0.12 + this.stage * 0.1;
    audio.swoosh();
    this.renderHud();
  }

  // ------------------------------------------------------------------ wrong
  protected onWrong(btn: HTMLButtonElement | null) {
    const timeout = !btn;
    this.combo = 0;
    this.missed.includes(this.word) || this.missed.push(this.word);
    this.retry.push({ w: this.word, due: this.asked + 4 });
    if (this.rush) this.lives--;
    audio.wrong();
    audio.duck();
    shake(0.55);
    punch(0.02);
    this.flash('#ff2d4a', 0.45);

    if (btn) {
      btn.classList.add('is-wrong');
      nope(btn);
      const bc = center(btn);
      particles.burst(bc.x, bc.y, { count: 10, sprite: 'puff', speed: [100, 300], size: [20, 36], shrink: 0.1, g: -100, drag: 3, life: [0.4, 0.7] });
    } else {
      this.banner(t('timeUp'));
    }
    const good = this.buttons[this.answerIdx];
    good.classList.add('is-correct');
    this.buttons.forEach((b, i) => i !== this.answerIdx && b !== btn && b.classList.add('is-dim'));
    loop('quiz:hint', good, () => gsap.to(good, { scale: 1.06, duration: 0.35, yoyo: true, repeat: -1, ease: 'sine.inOut' }), { scale: 1 });

    // heart break
    if (this.rush) {
      const heart = this.hearts[this.lives];
      if (heart) {
        const hc = center(heart);
        gsap.timeline()
          .to(heart, { scale: 1.6, duration: 0.12, ease: 'power2.out' })
          .add(() => {
            heart.classList.add('lost');
            particles.burst(hc.x, hc.y, { count: 10, sprite: 'heart', speed: [150, 400], size: [12, 20], g: 1400, life: [0.6, 1] });
            audio.heartbreak();
          })
          .to(heart, { scale: 1, duration: 0.5, ease: 'elastic.out(1,0.4)' });
      }
    }

    // cool things down
    stopLoop('quiz:combo');
    gsap.to(this.comboEl, { scale: 0, duration: 0.3, ease: 'back.in(2)' });
    if (this.stage > 0) {
      this.stage = 0;
      audio.setIntensity(0, this.fever);
      if (!this.fever) background.setTheme(this.baseTheme, 0.6);
      background.speed.v = this.fever ? 0.7 : 0.12;
    }
    if (!this.fever) this.feverGauge = Math.max(0, this.feverGauge - 0.35);
    this.renderHud();

    this.revealAnswer(timeout);
  }

  /** show the right answer after a miss. Base: flip the card over to the answer face. */
  protected revealAnswer(timeout: boolean) {
    const back = document.createElement('canvas');
    this.drawAnswer(back);
    const front = this.cardCv;
    gsap.delayedCall(timeout ? 0.35 : 0.25, async () => {
      if (this.isOver()) return;
      speak(this.word.h);
      await flipper.flip({ el: this.cardEl, front, back, from: 0, to: Math.PI, duration: 0.65, hop: 30, onMid: () => audio.pop(0.7) });
      if (this.isOver()) return;
      this.cardEl.replaceChild(back, this.cardCv);
      back.className = 'card-cv';
      this.cardCv = back;
      this.showContinue();
    });
  }

  protected showContinue() {
    this.phase = 'reveal';
    this.contHint.classList.add('show');
    gsap.fromTo(this.contHint, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'back.out(2)' });
    loop('quiz:cont', this.contHint, () => gsap.to(this.contHint, { y: -6, duration: 0.45, yoyo: true, repeat: -1, ease: 'sine.inOut' }), { y: 0 });
  }

  protected drawAnswer(cv: HTMLCanvasElement) {
    drawAnswerBack(cv, this.cardW, this.cardH, this.word, i18n.lang, t('answer'));
  }

  protected continue() {
    if (this.phase !== 'reveal' || this.paused) return;
    this.phase = 'lock';
    audio.click();
    stopLoop('quiz:cont');
    stopLoop('quiz:hint');
    this.contHint.classList.remove('show');
    gsap.to(this.contHint, { opacity: 0, duration: 0.15 });
    if (this.rush && this.lives <= 0) return this.finish();
    gsap.to(this.buttons, { scale: 0, duration: 0.2, stagger: 0.03, ease: 'back.in(2)' });
    this.next(true);
  }

  // ------------------------------------------------------------------ end
  protected finish() {
    if (this.isOver()) return;
    this.phase = 'over';
    this.stopUrgency();
    if (this.fever) this.endFever();
    store.save();
    const stats: RunStats = {
      game: this.gid,
      level: this.ctx.level,
      mode: this.ctx.mode,
      score: this.score,
      correct: this.correct,
      asked: this.asked,
      maxCombo: this.maxCombo,
      missed: this.missed.slice(0, 30),
      rush: this.rush,
      runId: this.run?.id,
      durationMs: this.run ? Math.round(performance.now() - this.run.startedAt) : undefined,
    };
    if (import.meta.env.DEV && this.run) {
      // a failure here means SCORING in shared/api.ts drifted from this file's scoring
      const why = checkRun({ board: this.run.board, score: stats.score, correct: stats.correct, asked: stats.asked, maxCombo: stats.maxCombo, durationMs: stats.durationMs! });
      if (why) console.error('[cloud] checkRun failed:', why, stats);
    }
    stats.reward = awardRun(stats);
    const ov = document.getElementById('overlay')!;
    const txt = this.rush ? t('gameOver') : t('finished');
    const el = h('div', { class: `end-banner ${this.rush ? 'over' : 'done'}` }, txt);
    ov.append(el);
    if (this.rush) audio.gameOver();
    else audio.fanfare();
    shake(0.5);
    gsap.timeline({ onComplete: () => el.remove() })
      .fromTo(el, { y: -innerHeight / 2, scaleY: 1.4, scaleX: 0.7 }, { y: 0, scaleY: 1, scaleX: 1, duration: 0.45, ease: 'bounce.out' })
      .to(el, { opacity: 0, scale: 0.7, duration: 0.3, delay: 0.9 });
    gsap.to(this.buttons, { scale: 0, duration: 0.3, stagger: 0.04, ease: 'back.in(2)' });
    gsap.delayedCall(1.4, () => app.go(() => resultsScreen(stats)));
  }

  protected teardown() {
    this.phase = 'over';
    cloud.endRun();
    this.offLang();
    stopAllLoops('quiz:');
    gsap.killTweensOf(this.shown);
    audio.setIntensity(0);
    background.speed.v = 0.08;
    document.getElementById('overlay')!.replaceChildren();
  }

  // ------------------------------------------------------------------ per-frame
  protected update(dt: number) {
    if (this.paused) return;
    if (this.fever && (this.phase === 'ask' || this.phase === 'lock')) {
      this.feverT -= dt;
      this.feverGauge = Math.max(0, this.feverT / FEVER_TIME);
      this.feverFill.style.transform = `scaleX(${this.feverGauge})`;
      if (Math.random() < dt * 6) particles.rain(Math.random() < 0.25 ? 'blossom' : 'petalRed', 1);
      if (this.feverT <= 0) this.endFever();
    }
    if (this.phase !== 'ask' || !this.rush) return;
    this.timeLeft -= dt;
    this.renderTimer();
    const sec = Math.ceil(this.timeLeft);
    if (this.timeLeft <= 3 && sec !== this.lastTick) {
      this.lastTick = sec;
      audio.tick(sec <= 1);
      if (sec === 3) {
        loop('quiz:urgent', this.timerEl, () => gsap.to(this.timerEl, { x: 3, duration: 0.05, yoyo: true, repeat: -1, ease: 'none' }), { x: 0 });
        loop('quiz:urgentCard', this.cardEl, () => gsap.to(this.cardEl, { rotation: 1.2, duration: 0.08, yoyo: true, repeat: -1, ease: 'sine.inOut' }), { rotation: 0 });
      }
      pop(this.timerEl, 0.4);
    }
    if (this.timeLeft <= 0) {
      this.phase = 'lock';
      this.stopUrgency();
      store.recordWord(this.word.h, false);
      this.onWrong(null);
    }
  }

  protected stopUrgency() {
    stopLoop('quiz:urgent');
    stopLoop('quiz:urgentCard');
  }

  protected renderTimer() {
    const f = clamp(this.timeLeft / this.timeMax, 0, 1);
    this.timerFill.style.transform = `scaleX(${f})`;
    this.timerFill.dataset.level = f > 0.5 ? 'ok' : f > 0.25 ? 'warn' : 'danger';
  }

  protected renderHud() {
    this.feverFill.style.transform = `scaleX(${this.feverGauge})`;
    this.feverRow.classList.toggle('ready', this.feverGauge > 0.8 && !this.fever);
  }

  protected setPaused(p: boolean) {
    if (this.isOver() || this.phase === 'intro' || this.paused === p) return;
    this.paused = p;
    this.pauseModal.classList.toggle('hidden', !p);
    if (p) {
      audio.stopMusic();
      gsap.fromTo(this.pauseModal.firstElementChild, { scale: 0.4, rotation: -8 }, { scale: 1, rotation: 0, duration: 0.5, ease: 'elastic.out(1,0.5)' });
    } else {
      audio.startMusic();
    }
  }

  protected onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') return this.setPaused(!this.paused);
    if (this.paused) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 4 && this.phase === 'ask') {
      const b = this.buttons[n - 1];
      gsap.fromTo(b, { scaleX: 1.08, scaleY: 0.88 }, { scaleX: 1, scaleY: 1, duration: 0.5, ease: 'elastic.out(1.2,0.35)' });
      this.answer(n - 1);
    }
    if ((e.key === 'Enter' || e.key === ' ') && this.phase === 'reveal') this.continue();
  }

  // ------------------------------------------------------------------ small fx
  protected floatText(text: string, x: number, y: number, cls = '') {
    const el = h('div', { class: `float-pts ${cls}` }, text);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.getElementById('overlay')!.append(el);
    gsap.timeline({ onComplete: () => el.remove() })
      .fromTo(el, { scale: 0, xPercent: -50, yPercent: -50 }, { scale: 1.25, duration: 0.18, ease: 'back.out(3)' })
      .to(el, { scale: 1, duration: 0.2 })
      .to(el, { y: -90, opacity: 0, duration: 0.6, ease: 'power2.in' }, 0.25);
  }

  protected banner(text: string) {
    const el = h('div', { class: 'banner' }, text);
    const cc = center(this.cardEl);
    el.style.top = `${cc.y}px`;
    document.getElementById('overlay')!.append(el);
    gsap.timeline({ onComplete: () => el.remove() })
      .fromTo(el, { scale: 2.4, opacity: 0, yPercent: -50 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(2)' })
      .to(el, { opacity: 0, y: -30, duration: 0.3, delay: 0.5 });
  }

  protected flash(color: string, strength: number) {
    const f = document.getElementById('flash')!;
    f.style.background = color;
    gsap.fromTo(f, { opacity: strength }, { opacity: 0, duration: 0.35, ease: 'power2.out', overwrite: true });
  }
}
