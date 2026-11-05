/**
 * Word Detective · 猜 — learn words you have never seen. Each round opens five unseen words as
 * case files. A case starts with a guess: the word glows inside a real sentence and the translation
 * is the evidence (one wrong answer is a word that really is in that sentence). A wrong guess costs
 * nothing and opens the file anyway. The case then comes back, spaced between the others, as a
 * listening question (听) and a recall question (认); answering both closes it with a red 结 seal.
 *
 * Score, combo, FEVER, pause and the results flow come from the Meaning Rush engine (QuizGame);
 * this class owns the case file card, the docket and the reveal sheet.
 */
import gsap from 'gsap';
import type { Word } from '../../core/data';
import { LEVELS, loadLevel } from '../../core/data';
import type { ThemeName } from '../../engine/background';
import { h, center, rand, wait } from '../../core/util';
import { i18n, t, tx, type Key } from '../../core/i18n';
import { store } from '../../core/store';
import { audio, speak } from '../../engine/audio';
import { particles } from '../../engine/particles';
import { shake, punch } from '../../engine/shake';
import { pop, nope, pressable, loop, stopLoop } from '../../engine/juice';
import { ICON } from '../../ui/widgets';
import { QuizGame } from '../quiz/QuizGame';
import type { GameContext } from '../registry';
import type { Screen } from '../../core/app';
import type { RunStats } from '../../screens/results';
import { Docket, pickCases, sentenceClues, meaningChoices, hanziChoices, type Case, type Step } from './cases';
import './detective.css';

type SheetKind = 'solved' | 'lead' | 'mixed';

const CLUE_COST = 30;
const PUNCT = /[\p{P}\p{S}\s]/u;

const STEP_UI: Record<Step, { hz: string; name: Key; ask: Key; color: string; dark: string }> = {
  guess: { hz: '猜', name: 'detGuess', ask: 'detGuessAsk', color: '#ffb020', dark: '#d97b06' },
  listen: { hz: '听', name: 'detListen', ask: 'detListenAsk', color: '#3da5ff', dark: '#1c6fd1' },
  recall: { hz: '认', name: 'detRecall', ask: 'detRecallAsk', color: '#ff5fa2', dark: '#d02f74' },
};

const LENS = `<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6.2" fill="#bfe6ff" stroke="currentColor" stroke-width="2.6"/><path d="M14.6 14.6l5.6 5.6" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/><path d="M7.4 8.6a3 3 0 0 1 2.2-1.8" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`;

export function create(ctx: GameContext): Screen {
  return new DetectiveGame({ ...ctx, mode: 'zen' }).init();
}

/** words a learner at this level can be expected to read: every lower level, plus this level's words they have answered right */
async function knownWords(level: number, words: Word[]): Promise<Map<string, Word>> {
  const lower = await Promise.all(LEVELS.filter((L) => L.n < level).map((L) => loadLevel(L.n).catch(() => [] as Word[])));
  const stats = store.progress.words;
  const known = new Map<string, Word>();
  for (const w of [...lower.flat(), ...words.filter((w) => (stats[w.h]?.[1] ?? 0) > 0)]) known.set(w.h, w);
  return known;
}

class DetectiveGame extends QuizGame {
  private docket = new Docket([]);
  private case!: Case;
  /** the step being asked (the docket moves the case on as soon as it is answered) */
  private step: Step = 'guess';
  private known = new Map<string, Word>();
  private clues: Word[] = [];

  private files!: HTMLElement;
  private tab!: HTMLElement;
  private body!: HTMLElement;
  private sheet!: HTMLElement;
  private seal!: HTMLElement;
  private sent: HTMLElement | null = null;
  private clueBtn: HTMLButtonElement | null = null;
  private exploded = true;
  private sheetKind: SheetKind | null = null;

  protected get gid() {
    return 'detective';
  }
  protected get baseTheme(): ThemeName {
    return 'case';
  }
  protected get ranked() {
    return false;
  }
  protected get zenTotal() {
    return Infinity;
  }
  protected get explodeDelay() {
    return this.step === 'guess' ? 0.5 : 0.9;
  }

  init(): Screen {
    const screen = super.init();
    this.el.classList.add('detective');

    this.files = h('div', { class: 'dt-files' });
    this.el.querySelector('.stage-area')!.prepend(this.files);

    this.tab = h('div', { class: 'dt-tab' });
    this.body = h('div', { class: 'dt-body' });
    this.sheet = h('div', { class: 'dt-sheet' });
    this.seal = h('div', { class: 'dt-seal' }, '对');
    this.cardEl.classList.add('dt-card');
    this.cardEl.removeAttribute('role');
    this.cardEl.replaceChildren(
      h('div', { class: 'dt-clip', html: '<svg viewBox="0 0 24 48"><path d="M8 40V10a5 5 0 0 1 10 0v26a3 3 0 0 1-6 0V14" fill="none" stroke="#2a1a3a" stroke-width="3.4" stroke-linecap="round"/><path d="M8 40V10a5 5 0 0 1 10 0v26a3 3 0 0 1-6 0V14" fill="none" stroke="#c9d3e0" stroke-width="1.6" stroke-linecap="round"/></svg>' }),
      this.tab,
      this.body,
      this.sheet,
      this.seal,
    );
    return screen;
  }

  // ------------------------------------------------------------------ layout
  /** the case file grows with its contents; only the width is fixed */
  protected layoutCard() {
    const wrap = this.cardEl.parentElement!;
    this.cardW = Math.round(Math.min(wrap.clientWidth, 440));
    this.cardEl.style.width = `${this.cardW}px`;
  }

  /** a closed file with a big 猜 seal while the countdown runs */
  protected introCard() {
    this.renderTab('guess');
    this.body.replaceChildren(h('div', { class: 'dt-cover' }, h('span', { class: 'dt-cover-seal' }, '猜'), tx('detName')));
  }

  protected async start() {
    const words = pickCases(this.ctx.words, store.progress.words);
    this.docket = new Docket(words);
    this.renderFiles();
    this.known = await knownWords(this.ctx.level, this.ctx.words);
    if (this.isOver()) return;
    return super.start();
  }

  protected next(fromReveal: boolean) {
    if (this.docket.allClosed) return Promise.resolve(this.finish());
    return super.next(fromReveal);
  }

  // ------------------------------------------------------------------ docket
  protected pickWord(): Word {
    this.case = this.docket.next()!;
    this.step = this.case.step;
    return this.case.word;
  }

  protected pickChoices(answer: Word): Word[] {
    const pool = this.ctx.words;
    if (this.step === 'guess') {
      this.clues = sentenceClues(answer, this.known);
      return meaningChoices(answer, this.clues, [...pool, ...this.known.values()]);
    }
    this.clues = [];
    const rivals = this.docket.cases.filter((c) => c !== this.case && this.docket.isOpen(c)).map((c) => c.word);
    return hanziChoices(answer, rivals, pool);
  }

  protected renderLabels() {
    if (this.step === 'guess') return super.renderLabels();
    this.choices.forEach((w, i) => {
      const len = [...w.h].length;
      const L = this.labels[i];
      L.className = `ch-label hz ${len > 4 ? 'xs' : len > 2 ? 's' : ''}`;
      L.replaceChildren(h('span', { class: 'hz-h' }, w.h));
    });
  }

  private renderFiles() {
    const now = this.docket.cases.indexOf(this.case);
    this.files.replaceChildren(
      ...this.docket.cases.map((c, i) => {
        const open = this.docket.isOpen(c);
        const progress = c.closed ? 3 : !open ? 0 : c.step === 'guess' ? 0 : c.step === 'listen' ? 1 : 2;
        const glyph = [...c.word.h];
        return h(
          'div',
          { class: `dt-file ${open ? 'open' : ''} ${c.closed ? 'closed' : ''} ${i === now && !this.isOver() ? 'now' : ''}` },
          h('span', { class: 'dt-file-h' }, open ? (glyph.length > 2 ? glyph.slice(0, 2).join('') + '…' : c.word.h) : '?'),
          h('span', { class: 'dt-pips' }, ...[0, 1, 2].map((k) => h('i', { class: k < progress ? 'on' : '' }))),
        );
      }),
    );
  }

  private renderTab(step: Step) {
    const ui = STEP_UI[step];
    this.cardEl.style.setProperty('--sc', ui.color);
    this.cardEl.style.setProperty('--sd', ui.dark);
    this.tab.replaceChildren(h('span', { class: 'dt-tab-hz' }, ui.hz), tx(ui.name));
  }

  // ------------------------------------------------------------------ question
  protected async presentQuestion(_fromReveal: boolean) {
    const w = this.word;
    await Promise.race([document.fonts.load(`900 40px "Noto Sans SC"`, w.ex.zh + w.h + w.p), wait(1200)]);
    if (this.isOver()) return;

    this.exploded = false;
    this.cardEl.classList.remove('revealed', 'ok', 'bad');
    this.sheet.replaceChildren();
    gsap.set(this.seal, { opacity: 0 });
    this.renderTab(this.step);
    const n = this.docket.cases.indexOf(this.case) + 1;
    this.renderFiles();
    this.sent = null;
    this.clueBtn = null;

    if (this.step === 'guess') this.buildGuess(w);
    else if (this.step === 'listen') this.buildListen(w);
    else this.buildRecall(w);

    audio.whoosh();
    gsap.fromTo(this.cardEl, { y: -24, rotation: rand(-3, 3), scale: 0.92 }, { y: 0, rotation: 0, scale: 1, duration: 0.55, ease: 'back.out(2)' });
    gsap.fromTo(this.tab, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, delay: 0.1, ease: 'back.out(2.5)' });
    const nowFile = this.files.children[n - 1];
    if (nowFile) pop(nowFile, 0.6);

    // the builders above set this.sent; TS still narrows it to the null assigned before them
    const sent = this.sent as HTMLElement | null;
    const glyphs = sent ? [...sent.querySelectorAll<HTMLElement>('.dt-c')] : [];
    if (glyphs.length) {
      gsap.fromTo(glyphs, { y: -40, opacity: 0, rotation: () => rand(-12, 12) }, { y: 0, opacity: 1, rotation: 0, duration: 0.45, stagger: 0.03, ease: 'back.out(2.4)' });
      const tgt = sent!.querySelector('.dt-tgt, .dt-gap');
      if (tgt) {
        const at = 0.15 + Math.min(glyphs.length, 14) * 0.03;
        gsap.fromTo(tgt, { scale: 0 }, { scale: 1, duration: 0.6, delay: at, ease: 'elastic.out(1.15,0.42)' });
        gsap.delayedCall(at + 0.05, () => {
          if (this.isOver()) return;
          const c = center(tgt);
          particles.ring(c.x, c.y, 90, '#ffe08a', 8, 0.5);
          particles.burst(c.x, c.y, { count: 8, sprite: 'sparkGold', speed: [80, 240], size: [10, 20], g: 0, drag: 3, life: [0.3, 0.6], add: true });
          audio.pop(1.3);
        });
      }
      await wait(Math.round((0.35 + Math.min(glyphs.length, 14) * 0.03) * 1000));
    } else {
      await wait(300);
    }
  }

  /** sentence tiles: the case word is one glowing tile, known words are tagged so a clue can light them up */
  private sentence(w: Word, mode: 'glow' | 'gap') {
    const zh = w.ex.zh;
    const at = zh.indexOf(w.h);
    const known = new Map<number, Word>();
    for (const c of this.clues) for (let k = zh.indexOf(c.h); k >= 0; k = zh.indexOf(c.h, k + 1)) if (k + c.h.length <= at || k >= at + w.h.length) known.set(k, c);

    const sent = h('div', { class: 'dt-sent' });
    sent.style.setProperty('--fs', `${Math.round(Math.max(24, Math.min(44, (this.cardW - 56) / (Math.min([...zh].length, 9) + 1))))}px`);
    for (let i = 0; i < zh.length; ) {
      if (i === at) {
        sent.append(mode === 'glow' ? h('span', { class: 'dt-tgt' }, w.h) : h('span', { class: 'dt-gap', style: `--n:${[...w.h].length}` }, '?'));
        i += w.h.length;
        continue;
      }
      const k = known.get(i);
      if (k) {
        sent.append(h('span', { class: 'dt-known' }, ...[...k.h].map((ch) => h('span', { class: 'dt-c' }, ch))));
        i += k.h.length;
        continue;
      }
      const ch = zh[i];
      const last = sent.lastElementChild;
      if (PUNCT.test(ch) && last) {
        const group = h('span', { class: 'dt-g' });
        last.before(group);
        group.append(last, h('span', { class: 'dt-c p' }, ch));
      } else sent.append(h('span', { class: 'dt-c' }, ch));
      i++;
    }
    this.sent = sent;
    return sent;
  }

  private buildGuess(w: Word) {
    const th = i18n.lang === 'th';
    const usable = this.clues.some((c) => w.ex.zh.includes(c.h));
    const clue = h('button', { class: 'dt-clue', disabled: !usable }, h('span', { class: 'dt-clue-ic', html: LENS }), usable ? t('detClue').replace('{n}', String(CLUE_COST)) : t('detNoClue'));
    this.clueBtn = clue;
    pressable(clue, () => this.useClue());
    const sent = this.sentence(w, 'glow');
    const chips = h('div', { class: 'dt-chips' });
    this.body.replaceChildren(
      h('p', { class: 'dt-ask' }, tx('detGuessAsk')),
      sent,
      chips,
      h('div', { class: `dt-trans ${th ? 'th' : ''}` }, h('span', { class: 'dt-trans-k' }, th ? 'คำแปล' : 'Translation'), th ? w.ex.th : w.ex.en),
      clue,
    );
    if (this.case.clued) {
      clue.disabled = true;
      sent.querySelectorAll('.dt-known').forEach((el) => el.classList.add('lit'));
      chips.append(...this.clueChips(w));
    }
  }

  private buildListen(w: Word) {
    const ear = h('button', { class: 'dt-ear', 'aria-label': 'Play', html: ICON.speaker });
    const muted = !store.settings.sound || !store.settings.voice;
    const peek = h('button', { class: 'dt-peek' }, tx('detPeek'));
    const showPy = () => peek.replaceWith(h('span', { class: 'dt-py' }, w.p));
    pressable(ear, () => {
      speak(w.h, true);
      pop(ear, 0.8);
      this.earRings(ear);
    });
    pressable(peek, () => {
      audio.pop(1.2);
      showPy();
    });
    this.body.replaceChildren(h('p', { class: 'dt-ask' }, tx('detListenAsk')), ear, peek);
    if (muted) showPy();
    gsap.delayedCall(0.45, () => {
      if (this.isOver() || this.word !== w) return;
      speak(w.h);
      this.earRings(ear);
    });
    loop('quiz:ear', ear, () => gsap.to(ear, { scale: 1.06, duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' }), { scale: 1 });
  }

  private earRings(ear: HTMLElement) {
    for (let k = 0; k < 2; k++) {
      const ring = h('span', { class: 'dt-ring' });
      ear.append(ring);
      gsap.fromTo(ring, { scale: 1, opacity: 0.8 }, { scale: 2, opacity: 0, duration: 0.8, delay: k * 0.22, ease: 'power2.out', onComplete: () => ring.remove() });
    }
  }

  private buildRecall(w: Word) {
    const th = i18n.lang === 'th';
    this.body.replaceChildren(
      h('p', { class: 'dt-ask' }, tx('detRecallAsk')),
      h('p', { class: `dt-meaning ${th ? 'th' : ''}` }, th ? w.th : w.en),
      this.sentence(w, 'gap'),
    );
  }

  private useClue() {
    if (this.phase !== 'ask' || this.paused || !this.sent || this.case.clued) return;
    this.case.clued = true;
    const prev = this.score;
    this.score = Math.max(0, this.score - CLUE_COST);
    this.rollScore(prev, this.score);
    this.clueBtn!.disabled = true;
    audio.pop(0.9);
    const known = [...this.sent.querySelectorAll<HTMLElement>('.dt-known')];
    const chips = this.clueChips(this.word);
    this.body.querySelector('.dt-chips')!.append(...chips);
    gsap.fromTo(chips, { scale: 0, rotation: () => rand(-12, 12) }, { scale: 1, rotation: 0, duration: 0.5, stagger: 0.1, ease: 'elastic.out(1.1,0.5)' });
    known.forEach((el, i) =>
      gsap.delayedCall(i * 0.12, () => {
        if (this.isOver()) return;
        el.classList.add('lit');
        pop(el, 0.5);
        const c = center(el);
        particles.burst(c.x, c.y, { count: 5, sprite: 'sparkCyan', speed: [60, 180], size: [10, 18], g: 0, drag: 3, life: [0.3, 0.5], add: true });
        audio.pop(1 + i * 0.1);
      }),
    );
  }

  /** "五 = ห้า" for every known word that is in the sentence, in sentence order */
  private clueChips(w: Word) {
    const th = i18n.lang === 'th';
    return this.clues
      .filter((c) => w.ex.zh.includes(c.h))
      .sort((a, b) => w.ex.zh.indexOf(a.h) - w.ex.zh.indexOf(b.h))
      .map((c) => h('span', { class: 'dt-chip' }, h('b', null, c.h), th ? c.th : c.en));
  }

  // ------------------------------------------------------------------ answering
  protected answer(i: number) {
    if (this.phase !== 'ask' || this.paused) return;
    stopLoop('quiz:ear');
    this.docket.settle(this.case, i === this.answerIdx);
    super.answer(i);
  }

  protected speakAnswer() {
    if (this.step !== 'guess') speak(this.word.h);
  }

  protected celebrateCard() {
    this.cardEl.classList.add('ok');
    pop(this.cardEl, 0.5);
    const target = this.sent?.querySelector<HTMLElement>('.dt-tgt, .dt-gap');
    if (target && this.step === 'recall') {
      target.textContent = this.word.h;
      target.classList.add('filled');
    }
    if (this.step === 'guess') return;
    this.seal.textContent = this.case.closed ? '结' : this.combo >= 10 ? '绝' : this.combo >= 5 ? '好' : '对';
    gsap
      .timeline({ delay: 0.15 })
      .fromTo(this.seal, { scale: 3.2, opacity: 0, rotation: -30 }, { scale: 1, opacity: 1, rotation: -12, duration: 0.22, ease: 'power4.in' })
      .add(() => {
        if (this.isOver()) return;
        const sc = center(this.seal);
        particles.burst(sc.x, sc.y, { count: 12, sprite: ['ink', 'sparkRed'], speed: [120, 380], size: [14, 28], g: 600, life: [0.4, 0.8] });
        particles.ring(sc.x, sc.y, 120, '#ff4757', 10, 0.4);
        audio.boom(0.4);
        shake(0.25);
        if (this.case.closed) this.closeCase();
      });
  }

  /** a case just closed: its file gets the red 结 stamp */
  private closeCase() {
    this.renderFiles();
    const file = this.files.children[this.docket.cases.indexOf(this.case)] as HTMLElement | undefined;
    if (!file) return;
    const fc = center(file);
    gsap.fromTo(file, { scale: 1.5, rotation: -10 }, { scale: 1, rotation: 0, duration: 0.6, ease: 'elastic.out(1.2,0.4)' });
    particles.burst(fc.x, fc.y, { count: 16, sprite: ['star', 'sparkGold'], speed: [150, 420], size: [12, 22], g: 700, life: [0.5, 0.9] });
    particles.ring(fc.x, fc.y, 70, '#ffe08a', 8, 0.45);
    audio.gong();
    punch(0.02);
    this.banner(t('detClosed'));
  }

  protected explodeCard() {
    if (this.isOver() || this.exploded) return;
    this.exploded = true;
    if (this.step === 'guess') return this.openSheet('solved');
    const cc = center(this.cardEl);
    audio.swoosh();
    gsap
      .timeline()
      .to([this.body, this.seal], { y: -24, opacity: 0, duration: 0.24, ease: 'power2.in' })
      .add(() => {
        particles.burst(cc.x, cc.y, { count: 10, sprite: ['paper', 'puff'], speed: [200, 520], size: [20, 32], g: 1500, life: [0.5, 0.9] });
        gsap.set([this.body, this.seal], { y: 0, opacity: 1 });
        gsap.set(this.seal, { opacity: 0 });
        this.next(false);
      });
    gsap.to(this.buttons, { scale: 0, duration: 0.2, stagger: 0.03, ease: 'back.in(2)' });
  }

  protected onWrong(btn: HTMLButtonElement | null) {
    if (this.step !== 'guess') return super.onWrong(btn);
    // a wrong guess is part of learning: no combo loss, no review entry, the file opens anyway
    this.exploded = true;
    if (btn) {
      btn.classList.add('is-wrong');
      nope(btn);
    }
    this.buttons[this.answerIdx].classList.add('is-correct');
    this.buttons.forEach((b, i) => i !== this.answerIdx && b !== btn && b.classList.add('is-dim'));
    audio.pop(0.7);
    gsap.delayedCall(0.45, () => this.openSheet('lead'));
  }

  protected revealAnswer(_timeout: boolean) {
    this.exploded = true;
    this.cardEl.classList.add('bad');
    gsap.delayedCall(0.45, () => this.openSheet('mixed'));
  }

  // ------------------------------------------------------------------ reveal sheet
  private openSheet(kind: SheetKind) {
    if (this.isOver()) return;
    this.sheetKind = kind;
    const stamp = this.renderSheet(kind);
    this.cardEl.classList.remove('bad');
    this.cardEl.classList.add('revealed');
    gsap.fromTo(this.sheet, { rotationX: -70, opacity: 0, transformOrigin: '50% 0%' }, { rotationX: 0, opacity: 1, duration: 0.5, ease: 'back.out(1.6)' });
    gsap.fromTo(stamp, { scale: 3, opacity: 0, rotation: -28 }, { scale: 1, opacity: 1, rotation: 8, duration: 0.25, delay: 0.3, ease: 'power4.in' });
    gsap.delayedCall(0.55, () => {
      if (this.isOver()) return;
      const sc = center(stamp);
      const ink = kind === 'solved' ? 'sparkRed' : kind === 'lead' ? 'sparkCyan' : ('puff' as const);
      particles.burst(sc.x, sc.y, { count: 10, sprite: ink, speed: [100, 300], size: [12, 24], g: 400, life: [0.4, 0.7] });
      audio.boom(0.3);
      shake(0.15);
    });
    speak(this.word.h);
    this.showContinue();
  }

  private renderSheet(kind: SheetKind) {
    const w = this.word;
    const th = i18n.lang === 'th';
    const at = w.ex.zh.indexOf(w.h);
    const stamp = h('div', { class: `dt-stamp ${kind}` }, tx(kind === 'solved' ? 'detSolved' : kind === 'lead' ? 'detLead' : 'detMixed'));
    const say = h('button', { class: 'dt-say', 'aria-label': 'Play', html: ICON.speaker });
    pressable(say, () => {
      speak(w.ex.zh, true);
      pop(say, 0.8);
    });
    // the screen's tap-anywhere-to-continue listener must not see this tap
    say.addEventListener('pointerup', (e) => e.stopPropagation());
    this.sheet.replaceChildren(
      stamp,
      h('div', { class: 'dt-word' }, h('span', { class: 'dt-big' }, w.h), h('span', { class: 'dt-wmeta' }, h('span', { class: 'dt-wpy' }, w.p), h('span', { class: `dt-wm ${th ? 'th' : ''}` }, th ? w.th : w.en))),
      h(
        'div',
        { class: 'dt-ex' },
        say,
        h('div', { class: 'dt-ex-zh' }, w.ex.zh.slice(0, at), h('mark', null, w.h), w.ex.zh.slice(at + w.h.length)),
        h('div', { class: 'dt-ex-py' }, w.ex.py),
        h('div', { class: `dt-ex-tr ${th ? 'th' : ''}` }, th ? w.ex.th : w.ex.en),
      ),
      h('p', { class: 'dt-note' }, tx(kind === 'lead' ? 'detLeadNote' : 'detBackSoon')),
    );
    return stamp;
  }

  // ------------------------------------------------------------------ end
  protected extraStats(): Partial<RunStats> {
    return { cases: this.docket.cases.map((c) => ({ w: c.word, guessed: !!c.guessed, misses: c.misses })) };
  }

  protected onLangChange() {
    super.onLangChange();
    if (this.phase === 'reveal' && this.sheetKind) gsap.set(this.renderSheet(this.sheetKind), { rotation: 8 });
    if (this.phase === 'ask' && this.word) {
      if (this.step === 'guess') this.buildGuess(this.word);
      if (this.step === 'recall') this.buildRecall(this.word);
    }
  }

  protected teardown() {
    super.teardown();
    stopLoop('quiz:ear');
  }
}
