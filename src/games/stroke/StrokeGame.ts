/**
 * Stroke Master (笔): HSK words fall; write them character by character in the right stroke order.
 * Rush: 3 hearts, endless. Zen: 20 words, slow, landing is free.
 * Scoring lives in ./score.ts; per-word facts are recorded in `facts` (and exported via `lastRun`)
 * so a ranked submission can be built from them later.
 */
import gsap from 'gsap';
import type { Screen } from '../../core/app';
import { app } from '../../core/app';
import type { Word } from '../../core/data';
import { h, formatNum } from '../../core/util';
import { t, tx, i18n } from '../../core/i18n';
import { store } from '../../core/store';
import { audio } from '../../engine/audio';
import { pressable } from '../../engine/juice';
import { langToggle, muteButton, iconButton, ICON } from '../../ui/widgets';
import type { GameContext } from '../registry';
import { resultsScreen, type RunStats } from '../../screens/results';
import { awardRun } from '../../core/meta';
import { loadStrokes, glyphOf, type Glyph, type StrokeLevel } from '../../core/strokes';
import { grade, length, type WhyNot } from './matcher';
import { Scene, clamp, type FallWord } from './scene';
import { Pane, type PaneView, type RawPt } from './pane';
import { sfx } from './sfx';
import { strokePoints, wordPoints, type WordFact } from './score';

type Phase = 'loading' | 'intro' | 'count' | 'play' | 'paused' | 'ending' | 'over';

const LENIENCY = 1.15;
const ZEN_TOTAL = 20;
const MAX_CHARS = 4;
const MIN_STROKE_LEN = 18;

interface Entry {
  w: Word;
  chars: Glyph[];
  strokes: number;
}

/** what the last finished run recorded, for a future ranked submission */
export interface RunRecord {
  level: number;
  mode: string;
  score: number;
  startedAt: number;
  durationMs: number;
  facts: WordFact[];
}
export let lastRun: RunRecord | null = null;

export function create(ctx: GameContext): Screen {
  return new StrokeGame(ctx).screen;
}

class StrokeGame {
  screen: Screen;
  private ctx: GameContext;
  private rush: boolean;
  private phase: Phase = 'loading';
  private dead = false;
  private scene = new Scene();
  private pane: Pane;
  private el: HTMLElement;
  private skyEl: HTMLElement;
  private intro: HTMLElement;
  private goBtn: HTMLButtonElement;
  private seal: HTMLCanvasElement;
  private sealGlyph: Glyph | null = null;
  private scoreEl: HTMLElement;
  private comboEl: HTMLElement;
  private hearts: HTMLElement[] = [];
  private pauseModal: HTMLElement;
  private ro: ResizeObserver;
  private offLang: () => void;

  private pool: Entry[] = [];
  private seen = new Set<string>();
  private data: StrokeLevel | null = null;

  // run state
  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private lives = 3;
  private cleared = 0;
  private landed = 0;
  private spawned = 0;
  private spawnT = 0;
  private facts: WordFact[] = [];
  private missed: Word[] = [];
  private startedAt = 0;
  private pausedMs = 0;
  private pauseAt = 0;
  private msg: { text: string; t0: number } | null = null;
  private chipKey = '';
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.rush = ctx.mode === 'rush';
    this.pane = new Pane(t('strokeDraw'), t('strokeOutline'), store.settings.strokeOutline !== false);
    this.pane.prompt.dataset.i18n = 'strokeDraw';
    this.pane.toggle.dataset.i18n = 'strokeOutline';
    this.pane.onStroke = (raw) => this.submit(raw);
    this.pane.onOutline = (on) => {
      store.settings.strokeOutline = on;
      store.save();
      audio.pop(on ? 1.2 : 0.9);
    };

    this.scoreEl = h('span', { class: 'score-v' }, '0');
    this.comboEl = h('span', { class: 'sk-combo' }, '');
    const lifeBox = h('div', { class: 'hearts' });
    if (this.rush) {
      for (let i = 0; i < 3; i++) {
        const he = h('span', { class: 'heart', html: ICON.heart });
        this.hearts.push(he);
        lifeBox.append(he);
      }
    } else lifeBox.append(h('span', { class: 'zen-badge' }, tx('modeZen')));

    const top = h('div', { class: 'topbar game-top' }, iconButton(ICON.pause, 'Pause', () => this.setPaused(true)), lifeBox, h('div', { class: 'spacer' }), muteButton(), langToggle());
    const scoreRow = h('div', { class: 'sk-row' }, h('div', { class: 'score-pill' }, h('span', { class: 'score-ic', html: ICON.blossom }), this.scoreEl), this.comboEl);
    this.skyEl = h('div', { class: 'sk-sky', 'aria-label': 'Falling words. Tap one to target it.' });
    this.skyEl.addEventListener('pointerdown', (e) => {
      if (this.phase !== 'play') return;
      const f = this.scene.hit(e.clientX, e.clientY);
      if (f) {
        this.scene.target = f;
        f.tapLocked = true;
        this.msg = null;
        sfx.tick();
      }
    });

    this.seal = h('canvas', { class: 'sk-seal', width: '232', height: '232', 'aria-hidden': 'true' });
    this.goBtn = h('button', { class: 'sk-go', disabled: '' }, tx('loading'));
    this.goBtn.addEventListener('click', () => this.onGo());
    this.intro = h(
      'div',
      { class: 'sk-intro' },
      h(
        'div',
        { class: 'sk-card' },
        this.seal,
        h('h1', null, tx('strokeName')),
        h('p', null, tx('strokeDesc')),
        h('ul', null, h('li', null, tx('strokeTip1')), h('li', null, tx('strokeTip2')), h('li', null, tx('strokeTip3'))),
        this.goBtn,
        h('p', { class: 'sk-fine' }, 'Stroke data: Make Me a Hanzi via hanzi-writer-data, Arphic Public License'),
      ),
    );

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
            import('../registry').then(({ GAMES }) => app.go(() => levelsScreen(GAMES.find((g) => g.id === 'stroke')!), { x: e.clientX, y: e.clientY })),
          );
        }),
      ),
    );

    this.el = h('div', { class: 'screen stroke' }, this.scene.cv, top, scoreRow, this.skyEl, this.pane.el, this.intro, this.pauseModal);
    this.ro = new ResizeObserver(() => this.layout());
    this.offLang = i18n.onChange(() => {
      this.chipKey = '';
      this.updateCombo();
    });
    if (import.meta.env.DEV) (window as any).__stroke = this;
    this.screen = {
      el: this.el,
      theme: 'vault',
      enter: () => this.enter(),
      leave: () => this.teardown(),
      update: (dt) => this.update(dt),
      onKey: (e) => e.key === 'Escape' && this.phase === 'play' && this.setPaused(true),
      onHidden: () => this.phase === 'play' && this.setPaused(true),
    };
  }

  private modalBtn(k: 'resume' | 'quit', color: string, onTap: (e: PointerEvent) => void) {
    const b = h('button', { class: 'big-btn', style: `--c:${color}` }, h('span', { class: 'big-btn-label' }, tx(k)));
    pressable(b, (e) => {
      audio.pop();
      onTap(e);
    });
    return b;
  }

  // ------------------------------------------------------------------ setup
  private layout() {
    if (this.dead) return;
    const r = this.skyEl.getBoundingClientRect();
    this.scene.layout({ x: r.left, y: r.top, w: r.width, h: r.height });
    this.pane.layout();
  }

  private enter() {
    this.layout();
    this.ro.observe(this.el);
    this.ro.observe(this.pane.el);
    addEventListener('resize', this.onResize);
    this.load();
  }
  private onResize = () => this.layout();

  private load() {
    this.phase = 'loading';
    this.goBtn.disabled = true;
    this.goBtn.replaceChildren(tx('loading'));
    loadStrokes(this.ctx.level)
      .then((data) => {
        if (this.dead) return;
        this.data = data;
        this.pool = [];
        for (const w of this.ctx.words) {
          if (w.h.length > MAX_CHARS) continue;
          const chars: Glyph[] = [];
          for (const ch of w.h) {
            const g = /\p{Script=Han}/u.test(ch) ? glyphOf(ch, data) : null;
            if (!g) break;
            chars.push(g);
          }
          if (chars.length === w.h.length) this.pool.push({ w, chars, strokes: chars.reduce((a, g) => a + g.n, 0) });
        }
        this.sealGlyph = glyphOf('笔', data);
        this.phase = 'intro';
        this.goBtn.disabled = !this.pool.length;
        this.goBtn.replaceChildren(tx('strokeStart'));
      })
      .catch(() => {
        if (this.dead) return;
        this.phase = 'intro';
        this.goBtn.disabled = false;
        this.goBtn.replaceChildren(tx('loadFail'));
      });
  }

  private onGo() {
    if (!this.data) {
      this.load();
      return;
    }
    if (this.phase !== 'intro') return;
    audio.unlock();
    audio.pop(1.2);
    this.intro.style.display = 'none';
    this.phase = 'count';
    this.countdown().then(() => !this.dead && this.phase === 'count' && this.begin());
  }

  private async countdown() {
    const ov = document.getElementById('overlay')!;
    for (const n of [3, 2, 1, 0]) {
      if (this.dead) return;
      const el = h('div', { class: `countdown ${n ? '' : 'go'}` }, n ? String(n) : t('go'));
      ov.append(el);
      audio.countdown(n);
      gsap
        .timeline({ onComplete: () => el.remove() })
        .fromTo(el, { scale: 3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(2.5)' })
        .to(el, { scale: 0.6, opacity: 0, y: -40, duration: 0.25, delay: n ? 0.2 : 0.35, ease: 'power2.in' });
      await new Promise((r) => setTimeout(r, n ? 560 : 420));
    }
  }

  private begin() {
    this.scene.clear();
    this.score = this.combo = this.maxCombo = this.cleared = this.landed = this.spawned = 0;
    this.lives = 3;
    this.facts = [];
    this.missed = [];
    this.seen.clear();
    this.pausedMs = 0;
    this.spawnT = 0.5;
    this.msg = null;
    this.startedAt = performance.now();
    this.scene.playing = true;
    this.pane.enabled = true;
    this.pane.prompt.style.opacity = '1';
    this.phase = 'play';
    this.hud();
  }

  // ------------------------------------------------------------------ pacing
  private get resolved() {
    return this.cleared + this.landed;
  }
  private fallTime(strokes: number) {
    const base = clamp(6 + 1.5 * strokes - 0.25 * this.cleared, 5 + 0.9 * strokes, 60);
    return this.rush ? base : base * 1.6;
  }
  private spawnGap = () => (this.rush ? Math.max(2.4, 6.4 - 0.17 * this.cleared) : 5);
  private maxOnScreen = () => (this.rush ? Math.min(4, 2 + Math.floor(this.cleared / 5)) : 2);

  private spawn() {
    const cap = 6 + 2 * Math.floor(this.cleared / 3);
    const live = new Set(this.scene.words.map((f) => f.w.h));
    let pool = this.pool.filter((p) => p.strokes <= cap && !live.has(p.w.h) && !this.seen.has(p.w.h));
    if (!pool.length) {
      this.seen.clear();
      pool = this.pool.filter((p) => p.strokes <= cap && !live.has(p.w.h));
    }
    if (!pool.length) pool = this.pool.filter((p) => !live.has(p.w.h)).sort((a, b) => a.strokes - b.strokes).slice(0, 12);
    if (!pool.length) return;
    const e = pool[Math.floor(Math.random() * pool.length)];
    this.seen.add(e.w.h);
    this.scene.spawn(e.w, e.chars, this.fallTime(e.strokes));
    this.spawned++;
  }

  // ------------------------------------------------------------------ grading
  private submit(raw: RawPt[]) {
    if (this.phase !== 'play') return;
    const pts = this.pane.toBox(raw);
    if (length(pts) < MIN_STROKE_LEN) return;
    let f = this.scene.target && !this.scene.target.dead ? this.scene.target : null;
    if (f && f.ci === 0 && f.done === 0 && !f.tapLocked) f = null;
    if (f) {
      const r = grade(pts, f.chars[f.ci].med, f.done, LENIENCY);
      return r.ok ? this.accept(f, raw) : this.reject(f, raw, r.why);
    }
    const { sky } = this.scene;
    let pick: FallWord | null = null;
    let best = Infinity;
    for (const g of this.scene.words) {
      if (g.dead || g.fadeOut != null) continue;
      const r = grade(pts, g.chars[g.ci].med, g.done, LENIENCY);
      const s = r.avg - 45 * ((g.y - sky.y) / sky.h);
      if (r.ok && s < best) {
        best = s;
        pick = g;
      }
    }
    if (pick) this.accept(pick, raw);
    else this.reject(null, raw, 'miss');
  }

  private accept(f: FallWord, raw: RawPt[]) {
    const { scene, pane } = this;
    const now = scene.t;
    const g = f.chars[f.ci];
    const i = f.done++;
    f.lit[f.ci][i] = now;
    f.litT = now;
    f.missStroke = 0;
    scene.target = f;
    this.msg = null;
    pane.fxOk(raw, now);
    const end = raw[raw.length - 1];
    scene.strokeFx(f, f.ci, i, [pane.box.px + end[0], pane.box.py + 6]);
    this.score += strokePoints(this.combo);
    sfx.stroke(i);
    if (f.done >= g.n) {
      pane.fxClear(g, now);
      if (f.ci + 1 < f.chars.length) {
        f.ci++;
        f.done = 0;
        scene.charFx(f);
        sfx.chime();
      } else this.complete(f);
    }
    this.hud();
  }

  private reject(f: FallWord | null, raw: RawPt[], why?: WhyNot) {
    this.pane.fxBad(raw, this.scene.t);
    sfx.miss();
    if (f) {
      f.misses++;
      f.missStroke++;
      f.badT = this.scene.t;
      this.combo = 0;
    }
    this.msg = { text: !f ? t('strokeNoMatch') : why === 'order' ? t('strokeWrongOrder') : why === 'backwards' ? t('strokeWrongDir') : t('strokeRetry'), t0: this.scene.t };
    if (!this.reduced) this.pane.shakePane();
    this.hud();
  }

  private complete(f: FallWord) {
    f.dead = true;
    this.scene.target = null;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.cleared++;
    const perfect = f.misses === 0;
    const points = wordPoints({ strokes: f.total, perfect, combo: this.combo });
    this.score += points;
    this.facts.push({ h: f.w.h, strokes: f.total, perfect, ms: Math.round(f.age * 1000), landed: false, combo: this.combo, points });
    store.recordWord(f.w.h, true);
    this.scene.completeFx(f, points, perfect);
    sfx.done(this.combo);
    this.hud();
    gsap.fromTo(this.comboEl, { scale: 1.5 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' });
    this.checkEnd();
  }

  private land(f: FallWord) {
    f.dead = true;
    if (this.scene.target === f) this.scene.target = null;
    this.landed++;
    this.combo = 0;
    this.missed.push(f.w);
    this.facts.push({ h: f.w.h, strokes: f.total, perfect: false, ms: Math.round(f.age * 1000), landed: true, combo: 0, points: 0 });
    store.recordWord(f.w.h, false);
    this.scene.landFx(f);
    sfx.hurt();
    if (this.rush) {
      this.lives--;
      this.hearts[this.lives]?.classList.add('lost');
      gsap.fromTo(this.hearts[this.lives], { scale: 1.5 }, { scale: 1, duration: 0.4, ease: 'back.out(3)' });
    }
    this.hud();
    this.checkEnd();
  }

  private checkEnd() {
    if (this.phase !== 'play') return;
    if (this.rush ? this.lives <= 0 : this.resolved >= ZEN_TOTAL) this.finish();
  }

  // ------------------------------------------------------------------ HUD / chip
  private hud() {
    this.scoreEl.textContent = formatNum(this.score);
    this.updateCombo();
  }
  private updateCombo() {
    this.comboEl.textContent = `×${this.combo} ${t('combo')}`;
    this.comboEl.classList.toggle('on', this.combo >= 2);
  }

  private renderChip() {
    const chip = this.pane.chip;
    const f = this.scene.target && !this.scene.target.dead ? this.scene.target : null;
    const msg = this.msg && this.scene.t - this.msg.t0 < 1.5 ? this.msg.text : '';
    const key = `${msg}|${f ? `${f.w.h}${f.ci}.${f.done}` : this.phase}`;
    if (key === this.chipKey) return;
    this.chipKey = key;
    chip.className = `sk-chip${msg ? ' bad' : f ? '' : ' idle'}`;
    chip.replaceChildren();
    if (!f) {
      chip.textContent = msg || t('strokeAny');
      return;
    }
    const word = h('span', { class: 'sk-w' });
    f.chars.forEach((g, i) => word.append(h('b', { class: i < f.ci ? 'fin' : i === f.ci ? 'cur' : '' }, g.ch)));
    chip.append(word);
    if (msg) chip.append(msg);
    else {
      const dots = h('span', { class: 'sk-dots' });
      for (let i = 0; i < f.chars[f.ci].n; i++) dots.append(h('i', { class: i < f.done ? 'on' : '' }));
      chip.append(dots);
    }
  }

  // ------------------------------------------------------------------ pause
  private setPaused(on: boolean) {
    if (on && this.phase === 'play') {
      this.phase = 'paused';
      this.pauseAt = performance.now();
      this.pane.cancel();
      this.pane.enabled = false;
      this.pauseModal.classList.remove('hidden');
    } else if (!on && this.phase === 'paused') {
      this.pausedMs += performance.now() - this.pauseAt;
      this.phase = 'play';
      this.pane.enabled = true;
      this.pauseModal.classList.add('hidden');
    }
  }

  // ------------------------------------------------------------------ end
  private finish() {
    if (this.phase !== 'play') return;
    this.phase = 'ending';
    this.scene.playing = false;
    this.scene.target = null;
    this.pane.enabled = false;
    this.pane.cancel();
    for (const f of this.scene.words) f.fadeOut = this.scene.t;
    const durationMs = Math.round(performance.now() - this.startedAt - this.pausedMs);
    store.save();
    const stats: RunStats = {
      game: 'stroke',
      level: this.ctx.level,
      mode: this.ctx.mode,
      score: this.score,
      correct: this.cleared,
      asked: this.resolved,
      maxCombo: this.maxCombo,
      missed: this.missed.slice(0, 30),
      rush: this.rush,
      durationMs,
    };
    lastRun = { level: this.ctx.level, mode: this.ctx.mode, score: this.score, startedAt: this.startedAt, durationMs, facts: this.facts.slice() };
    stats.reward = awardRun(stats);
    const el = h('div', { class: `end-banner ${this.rush ? 'over' : 'done'}` }, this.rush ? t('gameOver') : t('finished'));
    document.getElementById('overlay')!.append(el);
    if (this.rush) audio.gameOver();
    else audio.fanfare();
    gsap
      .timeline({ onComplete: () => el.remove() })
      .fromTo(el, { y: -innerHeight / 2, scaleY: 1.4, scaleX: 0.7 }, { y: 0, scaleY: 1, scaleX: 1, duration: 0.45, ease: 'bounce.out' })
      .to(el, { opacity: 0, scale: 0.7, duration: 0.3, delay: 0.7 });
    gsap.delayedCall(1.4, () => !this.dead && app.go(() => resultsScreen(stats)));
  }

  private teardown() {
    this.dead = true;
    this.phase = 'over';
    this.ro.disconnect();
    removeEventListener('resize', this.onResize);
    this.offLang();
    this.scene.clear();
    document.getElementById('overlay')!.replaceChildren();
  }

  // ------------------------------------------------------------------ per frame
  private update(rawDt: number) {
    if (this.dead || this.phase === 'paused') return;
    const dt = Math.min(rawDt, 0.05);
    const { scene } = this;
    const play = this.phase === 'play';
    scene.step(dt, play);
    if (play) {
      this.spawnT -= dt;
      const room = scene.words.filter((f) => !f.dead).length < this.maxOnScreen();
      const left = this.rush || this.spawned < ZEN_TOTAL;
      if (this.spawnT <= 0 && room && left) {
        this.spawn();
        this.spawnT = this.spawnGap();
      }
      if (!scene.words.length && this.spawnT > 0.6 && left) this.spawnT = 0.6;
      const gy = scene.groundY;
      for (const f of scene.words) if (!f.dead && f.y > gy - f.s * 0.42) this.land(f);
      scene.sweep();
      if (scene.target?.dead) scene.target = null;
    } else if (this.phase === 'ending') scene.sweep();
    scene.draw();
    const f = scene.target && !scene.target.dead ? scene.target : null;
    let view: PaneView | null = null;
    if (f && this.phase !== 'ending') {
      const g = f.chars[f.ci];
      view = { g, done: f.done, lit: f.lit[f.ci], hint: f.missStroke >= 2 && f.done < g.n, outline: store.settings.strokeOutline !== false };
    }
    this.pane.draw(scene.t, view);
    this.renderChip();
    if (this.intro.style.display !== 'none') this.drawSeal();
  }

  private drawSeal() {
    const g = this.sealGlyph;
    const c = this.seal.getContext('2d')!;
    const S = 232;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    c.strokeStyle = 'rgba(255,201,60,.35)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(S / 2, S / 2, S / 2 - 4, 0, 7);
    c.stroke();
    if (!g) {
      c.fillStyle = '#ffc93c';
      c.font = '700 150px "Noto Sans SC", "PingFang SC", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('笔', S / 2, S / 2 + 8);
      return;
    }
    const cyc = g.n * 0.32 + 1.6;
    const tt = this.scene.t % cyc;
    const s = S * 0.7;
    const k = s / 1024;
    c.setTransform(k, 0, 0, -k, (S - s) / 2, (S - s) / 2 + 900 * k);
    c.fillStyle = 'rgba(243,234,215,.1)';
    for (const p of g.paths) c.fill(p);
    const fade = tt > cyc - 0.4 ? (cyc - tt) / 0.4 : 1;
    for (let i = 0; i < g.n; i++) {
      const lt = tt - i * 0.32;
      if (lt < 0) break;
      c.globalAlpha = Math.min(1, lt / 0.2) * fade;
      c.fillStyle = lt < 0.3 ? '#fff6dc' : '#ffc93c';
      c.shadowColor = '#ffc93c';
      c.shadowBlur = lt < 0.5 ? 20 : 6;
      c.fill(g.paths[i]);
    }
    c.globalAlpha = 1;
    c.shadowBlur = 0;
  }
}
