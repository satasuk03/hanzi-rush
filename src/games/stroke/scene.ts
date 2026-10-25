// Stroke Master scene: ink-night backdrop, falling words and the FX list.
// Words are painted into a per-word offscreen bitmap that is only redrawn when progress changes.
import type { Glyph } from '../../core/strokes';
import type { Word } from '../../core/data';
import { store } from '../../core/store';

export const COL = { ivory: '#f3ead7', gold: '#ffc93c', goldHi: '#ffe6a1', red: '#ff5a4e', jade: '#6fe3c1' };
export const RM = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const ease = (p: number) => 1 - (1 - p) ** 3;
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
/** particle count multiplier (reduced motion keeps ~30%) */
const PK = RM ? 0.3 : 1;

export interface FallWord {
  w: Word;
  chars: Glyph[];
  /** total strokes in the word */
  total: number;
  x: number;
  dx: number;
  y: number;
  /** character size */
  s: number;
  vy: number;
  /** current character / strokes done in it */
  ci: number;
  done: number;
  /** scene time each stroke lit, per char */
  lit: number[][];
  litT: number;
  misses: number;
  missStroke: number;
  badT: number;
  phase: number;
  age: number;
  tapLocked: boolean;
  dead: boolean;
  fadeOut?: number;
  cache?: HTMLCanvasElement;
  cacheKey?: string;
}

interface Fx {
  k: 'spark' | 'ring' | 'flash' | 'bolt' | 'shatter' | 'label';
  t0: number;
  life: number;
  [key: string]: any;
}

const cellW = (f: { s: number }) => f.s * 0.92;
const plateW = (f: FallWord) => f.chars.length * cellW(f) + f.s * 0.3;
const PAD = 18;

export class Scene {
  cv: HTMLCanvasElement;
  c: CanvasRenderingContext2D;
  W = 0;
  H = 0;
  dpr = 1;
  sky = { x: 0, y: 0, w: 0, h: 0 };
  t = 0;
  hitstop = 0;
  shake = 0;
  hurtT = -9;
  playing = false;
  target: FallWord | null = null;
  words: FallWord[] = [];
  private fx: Fx[] = [];
  private bg!: HTMLCanvasElement;
  private fog!: HTMLCanvasElement;
  private stars: { x: number; y: number; a: number; f: number; p: number; z: number }[] = [];
  private embers: { x: number; y: number; v: number; r: number; p: number; w: number }[] = [];
  private so: [number, number] = [0, 0];

  constructor() {
    this.cv = document.createElement('canvas');
    this.cv.className = 'sk-scene';
    this.cv.setAttribute('aria-hidden', 'true');
    this.c = this.cv.getContext('2d')!;
  }

  get groundY() {
    return this.sky.y + this.sky.h;
  }

  /** char size for a word of n characters */
  charSize(n: number) {
    return Math.min(clamp(this.sky.w * 0.17, 54, 86), (this.sky.w * 0.8) / (n * 0.92 + 0.3));
  }

  layout(sky: { x: number; y: number; w: number; h: number }) {
    this.W = innerWidth;
    this.H = innerHeight;
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
    this.sky = sky;
    for (const f of this.words) {
      f.s = this.charSize(f.chars.length);
      f.cacheKey = undefined;
    }
    this.paintBackdrop();
  }

  private paintBackdrop() {
    const { W, H, dpr, sky } = this;
    let seed = 11;
    const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    this.bg = document.createElement('canvas');
    this.bg.width = this.cv.width;
    this.bg.height = this.cv.height;
    const g = this.bg.getContext('2d')!;
    g.scale(dpr, dpr);
    const sk = g.createLinearGradient(0, 0, 0, H);
    sk.addColorStop(0, '#05070f');
    sk.addColorStop(0.35, '#0c1230');
    sk.addColorStop(0.62, '#1b1f45');
    sk.addColorStop(0.8, '#141734');
    sk.addColorStop(1, '#07080f');
    g.fillStyle = sk;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 240; i++) {
      g.fillStyle = `rgba(243,234,215,${0.15 + r() * 0.5})`;
      const z = r() < 0.92 ? 1 : 1.8;
      g.fillRect(r() * W, r() * H * 0.62, z, z);
    }
    this.stars = Array.from({ length: 46 }, () => ({ x: r() * W, y: r() * H * 0.55, a: 0.5 + r() * 0.5, f: 0.6 + r() * 2.2, p: r() * 6, z: 1 + r() * 1.4 }));
    const mx = Math.min(W - 40, sky.x + sky.w - 30);
    const my = sky.y + Math.min(80, sky.h * 0.16);
    const halo = g.createRadialGradient(mx, my, 10, mx, my, 260);
    halo.addColorStop(0, 'rgba(255,236,196,.22)');
    halo.addColorStop(0.25, 'rgba(255,220,170,.08)');
    halo.addColorStop(1, 'rgba(255,220,170,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, W, H);
    const md = g.createRadialGradient(mx - 10, my - 10, 4, mx, my, 34);
    md.addColorStop(0, '#fff8e6');
    md.addColorStop(1, '#e6cf9f');
    g.fillStyle = md;
    g.beginPath();
    g.arc(mx, my, 32, 0, 7);
    g.fill();
    g.fillStyle = 'rgba(160,130,90,.16)';
    for (const [a, b, c] of [[-9, -6, 7], [8, 6, 5], [-4, 12, 4], [12, -10, 3]]) {
      g.beginPath();
      g.arc(mx + a, my + b, c, 0, 7);
      g.fill();
    }
    const layers = [
      { base: 0.5, amp: 0.13, top: '#2a3170', bot: '#151a3d', f: 0.004 },
      { base: 0.6, amp: 0.11, top: '#1f2558', bot: '#0f1330', f: 0.006 },
      { base: 0.71, amp: 0.09, top: '#151a40', bot: '#0a0d22', f: 0.009 },
      { base: 0.84, amp: 0.07, top: '#0c0f27', bot: '#05060f', f: 0.013 },
    ];
    for (const L of layers) {
      const p1 = r() * 9;
      const p2 = r() * 9;
      const p3 = r() * 9;
      const yb = H * L.base;
      const a = H * L.amp;
      const ridge = (x: number) => yb - a * (0.65 * Math.abs(Math.sin(x * L.f + p1)) ** 1.6 + 0.25 * Math.sin(x * L.f * 2.7 + p2) + 0.1 * Math.sin(x * L.f * 7.3 + p3));
      const grd = g.createLinearGradient(0, yb - a, 0, H);
      grd.addColorStop(0, L.top);
      grd.addColorStop(0.5, L.bot);
      grd.addColorStop(1, '#05060f');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W + 4; x += 4) g.lineTo(x, ridge(x));
      g.lineTo(W, H);
      g.closePath();
      g.fill();
      const mist = g.createLinearGradient(0, yb - a * 0.2, 0, yb + a * 0.9);
      mist.addColorStop(0, 'rgba(140,155,230,0)');
      mist.addColorStop(0.5, 'rgba(140,155,230,.07)');
      mist.addColorStop(1, 'rgba(140,155,230,0)');
      g.fillStyle = mist;
      g.fillRect(0, yb - a * 0.2, W, a * 1.1);
    }
    this.fog = document.createElement('canvas');
    this.fog.width = 256;
    this.fog.height = 96;
    const fg = this.fog.getContext('2d')!;
    const fr = fg.createRadialGradient(128, 48, 0, 128, 48, 128);
    fr.addColorStop(0, 'rgba(150,165,240,.16)');
    fr.addColorStop(1, 'rgba(150,165,240,0)');
    fg.setTransform(1, 0, 0, 0.375, 0, 30);
    fg.fillStyle = fr;
    fg.fillRect(0, 0, 256, 256);
    if (!this.embers.length) this.embers = Array.from({ length: RM ? 10 : 34 }, () => this.newEmber(true));
  }

  private newEmber(any: boolean) {
    return { x: rand(0, this.W), y: any ? rand(this.H * 0.3, this.H) : this.H + 10, v: rand(8, 26), r: rand(0.6, 1.8), p: rand(0, 6), w: rand(0.4, 1.4) };
  }

  // ------------------------------------------------------------------ words
  spawn(w: Word, chars: Glyph[], fallTime: number): FallWord {
    const s = this.charSize(chars.length);
    const pw = chars.length * s * 0.92 + s * 0.3;
    const { sky } = this;
    const lo = sky.x + pw / 2 + 4;
    const hi = Math.max(lo, sky.x + sky.w - pw / 2 - 4);
    let x = (lo + hi) / 2;
    for (let k = 0; k < 12; k++) {
      x = rand(lo, hi);
      if (this.words.every((f) => Math.abs(f.x - x) > (plateW(f) + pw) / 2 + 6 || f.y > sky.y + s * 2.4)) break;
    }
    const f: FallWord = {
      w, chars, total: chars.reduce((a, g) => a + g.n, 0), x, dx: x, y: sky.y - s * 0.3, s, vy: sky.h / fallTime,
      ci: 0, done: 0, lit: chars.map((g) => new Array<number>(g.n).fill(-9)), litT: -9, misses: 0, missStroke: 0, badT: -9,
      phase: Math.random() * 6, age: 0, tapLocked: false, dead: false,
    };
    this.words.push(f);
    return f;
  }

  /** nearest word whose plate contains the point */
  hit(px: number, py: number): FallWord | null {
    let best: FallWord | null = null;
    let bd = Infinity;
    for (const f of this.words) {
      if (f.dead) continue;
      const hw = plateW(f) / 2 + 6;
      const hh = f.s * 0.55 + 8;
      if (Math.abs(px - f.dx) > hw || Math.abs(py - f.y) > hh) continue;
      const d = Math.hypot(px - f.dx, py - f.y);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  /** page position of a point on stroke i (0..1 along its median) of the word's character ci */
  strokePoint(f: FallWord, ci: number, i: number, at = 0.5): [number, number] {
    const m = f.chars[ci].med[i];
    const p = m[Math.min(m.length - 1, Math.floor((m.length - 1) * at))];
    const gs = f.s * 0.84;
    const cx = f.dx - (f.chars.length * cellW(f)) / 2 + cellW(f) * (ci + 0.5);
    return [cx - gs / 2 + (p[0] * gs) / 1024, f.y - gs / 2 + (p[1] * gs) / 1024];
  }

  // ------------------------------------------------------------------ update
  step(dt: number, moving: boolean) {
    this.t += dt;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      dt *= 0.1;
    }
    this.shake *= Math.pow(0.0015, dt);
    const { t } = this;
    for (const f of this.words) {
      f.age += dt;
      if (moving) f.y += f.vy * dt;
      f.dx = f.x + Math.sin(f.age * 1.2 + f.phase) * 3;
      if (f.fadeOut != null && t - f.fadeOut > 0.6) f.dead = true;
    }
    for (const e of this.fx) {
      if (e.k === 'spark' && t > e.t0) {
        e.vy += (e.g || 0) * dt;
        e.vx *= Math.pow(0.12, dt);
        e.vy *= Math.pow(0.3, dt);
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      }
    }
    this.fx = this.fx.filter((e) => t - e.t0 < e.life);
    for (const e of this.embers) {
      e.y -= e.v * dt;
      e.x += Math.sin(t * e.w + e.p) * 6 * dt;
      if (e.y < this.H * 0.2) Object.assign(e, this.newEmber(false));
    }
  }

  /** drop dead words (and free their bitmaps) */
  sweep() {
    for (const f of this.words) if (f.dead) f.cache = undefined;
    this.words = this.words.filter((f) => !f.dead);
  }

  clear() {
    this.words = [];
    this.fx = [];
    this.target = null;
  }

  // ------------------------------------------------------------------ FX spawners
  strokeFx(f: FallWord, ci: number, i: number, from: [number, number]) {
    const [tx, ty] = this.strokePoint(f, ci, i);
    this.fx.push({ k: 'bolt', x0: from[0], y0: from[1], x1: tx, y1: ty, t0: this.t, life: 0.26 });
    for (let k = 0; k < Math.round(10 * PK); k++) {
      const a = rand(0, TAU);
      const v = rand(40, 140);
      this.fx.push({ k: 'spark', x: tx, y: ty, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: this.t + 0.2, life: rand(0.3, 0.55), r: rand(1, 2.2), col: COL.goldHi });
    }
  }

  charFx(f: FallWord) {
    this.fx.push({ k: 'ring', x: f.dx, y: f.y, r0: f.s * 0.3, r1: f.s * 1.1, t0: this.t, life: 0.4, col: COL.goldHi });
  }

  completeFx(f: FallWord, gain: number, perfect: boolean) {
    const { t } = this;
    const n = f.chars.length;
    const R = Math.max(f.s * 1.6, plateW(f) * 0.7);
    this.fx.push({ k: 'flash', x: f.dx, y: f.y, r: R, t0: t, life: 0.35 });
    this.fx.push({ k: 'ring', x: f.dx, y: f.y, r0: f.s * 0.35, r1: R * 1.2, t0: t, life: 0.55, col: COL.gold });
    this.fx.push({ k: 'ring', x: f.dx, y: f.y, r0: f.s * 0.2, r1: R * 0.8, t0: t + 0.06, life: 0.45, col: COL.ivory });
    const parts: { ci: number; i: number; cx: number; cy: number; vx: number; vy: number; vr: number }[] = [];
    f.chars.forEach((g, ci) => {
      g.med.forEach((m, i) => {
        const cx = m.reduce((a, p) => a + p[0], 0) / m.length;
        const cy = m.reduce((a, p) => a + p[1], 0) / m.length;
        const ang = Math.atan2(cy - 512, cx - 512 + (ci - (n - 1) / 2) * 600) + rand(-0.4, 0.4);
        const v = rand(90, 220);
        parts.push({ ci, i, cx, cy, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - 60, vr: rand(-5, 5) });
      });
    });
    this.fx.push({ k: 'shatter', f, x: f.dx, y: f.y, s: f.s, parts, t0: t, life: 0.85 });
    for (let k = 0; k < Math.round(60 * PK); k++) {
      const ci = k % n;
      const [px, py] = this.strokePoint(f, ci, k % f.chars[ci].n, Math.random());
      const a = Math.atan2(py - f.y, px - f.dx) + rand(-0.6, 0.6);
      const v = rand(80, 320);
      this.fx.push({ k: 'spark', x: px, y: py, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: t, life: rand(0.5, 1.1), r: rand(1.2, 3.2), col: Math.random() < 0.7 ? COL.gold : COL.ivory, g: 160 });
    }
    this.fx.push({ k: 'label', x: f.dx, y: f.y, w: f.w, gain, perfect, t0: t, life: 2.4 });
    this.hitstop = 0.09;
    this.shake = RM ? 0 : 7;
  }

  landFx(f: FallWord) {
    const gy = this.groundY;
    for (let k = 0; k < Math.round(34 * PK); k++) {
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
      const v = rand(60, 260);
      this.fx.push({ k: 'spark', x: f.dx + rand(-f.s * 0.3, f.s * 0.3), y: gy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: this.t, life: rand(0.5, 0.9), r: rand(1.5, 3.5), col: Math.random() < 0.6 ? COL.red : COL.ivory, g: 520 });
    }
    this.fx.push({ k: 'label', x: f.dx, y: gy - f.s * 0.6, w: f.w, miss: true, t0: this.t, life: 2.2 });
    this.hurtT = this.t;
    this.shake = RM ? 0 : 14;
  }

  // ------------------------------------------------------------------ draw
  private base() {
    const { dpr, so } = this;
    this.c.setTransform(dpr, 0, 0, dpr, dpr * so[0], dpr * so[1]);
  }

  draw() {
    if (!this.bg) return;
    const { c, t, W, H, dpr } = this;
    this.so = this.shake > 0.3 ? [rand(-1, 1) * this.shake, rand(-1, 1) * this.shake] : [0, 0];
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.drawImage(this.bg, 0, 0);
    this.base();
    for (const s of this.stars) {
      c.globalAlpha = s.a * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.f + s.p)));
      c.fillStyle = COL.ivory;
      c.fillRect(s.x, s.y, s.z, s.z);
    }
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const fw = W * 1.3;
      const x = ((t * (5 + i * 3) + i * 520) % (W + fw)) - fw;
      c.globalAlpha = 0.9;
      c.drawImage(this.fog, x, H * (0.42 + i * 0.11) - 90, fw, 200);
    }
    for (const e of this.embers) {
      c.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3 + e.p));
      c.fillStyle = COL.gold;
      c.beginPath();
      c.arc(e.x, e.y, e.r, 0, 7);
      c.fill();
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    this.drawGround();
    for (const f of this.words) this.drawWord(f);
    this.drawFx();
    const ht = t - this.hurtT;
    if (ht < 0.7) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const v = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      v.addColorStop(0, 'rgba(255,90,78,0)');
      v.addColorStop(1, `rgba(255,60,50,${0.5 * (1 - ht / 0.7)})`);
      c.fillStyle = v;
      c.fillRect(0, 0, W, H);
    }
  }

  private drawGround() {
    const { c, sky, t } = this;
    const gy = this.groundY;
    let danger = 0;
    for (const f of this.words) danger = Math.max(danger, clamp(((f.y - sky.y) / sky.h - 0.6) / 0.4, 0, 1));
    if (!this.playing) danger = 0;
    const a = 0.18 + danger * (0.45 + 0.25 * Math.sin(t * 10));
    const g = c.createLinearGradient(sky.x, 0, sky.x + sky.w, 0);
    g.addColorStop(0, 'rgba(255,90,78,0)');
    g.addColorStop(0.5, `rgba(255,90,78,${a})`);
    g.addColorStop(1, 'rgba(255,90,78,0)');
    c.fillStyle = g;
    c.fillRect(sky.x, gy - 1, sky.w, 2);
    if (danger > 0) {
      const up = c.createLinearGradient(0, gy - 70, 0, gy);
      up.addColorStop(0, 'rgba(255,90,78,0)');
      up.addColorStop(1, `rgba(255,90,78,${danger * 0.16})`);
      c.fillStyle = up;
      c.fillRect(sky.x, gy - 70, sky.w, 70);
    }
  }

  /** repaint the word's bitmap: finished chars gold, current char's done strokes lit, rest ivory */
  private paintCache(f: FallWord, bad: boolean) {
    const { dpr, t } = this;
    const cw = cellW(f);
    const w = f.chars.length * cw;
    const cv = (f.cache ??= document.createElement('canvas'));
    cv.width = Math.ceil((w + PAD * 2) * dpr);
    cv.height = Math.ceil((f.s + PAD * 2) * dpr);
    const c = cv.getContext('2d')!;
    c.clearRect(0, 0, cv.width, cv.height);
    const gs = f.s * 0.84;
    const k = gs / 1024;
    f.chars.forEach((g, ci) => {
      const cx = PAD + cw * (ci + 0.5);
      const cy = PAD + f.s / 2;
      c.setTransform(dpr * k, 0, 0, -dpr * k, dpr * (cx - gs / 2), dpr * (cy - gs / 2 + 900 * k));
      for (let i = 0; i < g.n; i++) {
        const lit = ci < f.ci || (ci === f.ci && i < f.done);
        if (lit) {
          const lt = ci === f.ci ? t - f.lit[ci][i] : 9;
          c.fillStyle = lt < 0.25 ? '#fff6dc' : COL.gold;
          c.shadowColor = COL.gold;
          c.shadowBlur = (lt < 0.5 ? 26 * (1 - lt / 0.5) + 8 : 8) * dpr;
        } else {
          c.fillStyle = bad ? '#ffb3ad' : 'rgba(243,234,215,.94)';
          c.shadowBlur = 0;
        }
        c.fill(g.paths[i]);
      }
    });
  }

  private drawWord(f: FallWord) {
    const { c, t, sky } = this;
    const { dx: x, y, s } = f;
    const isT = f === this.target;
    const fade = Math.min(1, f.age / 0.6) * (f.fadeOut != null ? clamp(1 - (t - f.fadeOut) / 0.6, 0, 1) : 1);
    const depth = clamp((y - sky.y) / sky.h, 0, 1);
    const danger = this.playing && depth > 0.72;
    const bad = t - f.badT < 0.4;
    const cw = cellW(f);
    const pw = plateW(f);
    const ph = s * 1.08;
    this.base();
    c.globalAlpha = fade;
    const tr = c.createLinearGradient(0, y - s * 2.2, 0, y - s * 0.4);
    tr.addColorStop(0, 'rgba(243,234,215,0)');
    tr.addColorStop(1, 'rgba(243,234,215,.07)');
    c.fillStyle = tr;
    c.fillRect(x - pw * 0.25, y - s * 2.2, pw * 0.5, s * 1.8);
    // ink plate
    c.fillStyle = 'rgba(8,10,24,.74)';
    c.beginPath();
    c.roundRect(x - pw / 2, y - ph / 2, pw, ph, s * 0.34);
    c.fill();
    c.strokeStyle = bad || danger ? `rgba(255,90,78,${danger && !bad ? 0.5 + 0.4 * Math.sin(t * 12) : 0.9})` : isT ? COL.gold : 'rgba(243,234,215,.2)';
    c.lineWidth = isT ? 1.6 : 1.1;
    c.beginPath();
    c.roundRect(x - pw / 2, y - ph / 2, pw, ph, s * 0.34);
    c.stroke();
    if (isT) {
      c.save();
      c.translate(x - (f.chars.length * cw) / 2 + cw * (f.ci + 0.5), y);
      c.rotate(t * 1.4);
      c.strokeStyle = COL.gold;
      c.lineWidth = 2.4;
      c.shadowColor = COL.gold;
      c.shadowBlur = 10 * this.dpr;
      for (let k = 0; k < 4; k++) {
        c.beginPath();
        c.arc(0, 0, s * 0.62, (k * Math.PI) / 2 + 0.25, (k * Math.PI) / 2 + 1.0);
        c.stroke();
      }
      c.restore();
    }
    // glyph bitmap, redrawn only when progress changes (or while a stroke's glow settles)
    const key = `${f.ci}:${f.done}:${bad ? 1 : 0}:${this.dpr}:${s | 0}`;
    if (f.cacheKey !== key || t - f.litT < 0.55) {
      this.paintCache(f, bad);
      f.cacheKey = key;
    }
    const jx = bad ? Math.sin(t * 90) * 3 : 0;
    c.drawImage(f.cache!, x - (f.chars.length * cw) / 2 - PAD + jx, y - s / 2 - PAD, f.cache!.width / this.dpr, f.cache!.height / this.dpr);
    if (store.settings.pinyin) {
      c.font = '700 11px Nunito, system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.fillStyle = 'rgba(243,234,215,.5)';
      c.fillText(f.w.p, x, y - ph / 2 - 5);
    }
    c.shadowBlur = 0;
    c.globalAlpha = 1;
  }

  private drawFx() {
    const { c, t, sky } = this;
    const dpr = this.dpr;
    for (const e of this.fx) {
      const p = (t - e.t0) / e.life;
      if (p < 0) continue;
      this.base();
      switch (e.k) {
        case 'spark':
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = 1 - p;
          c.fillStyle = e.col;
          c.beginPath();
          c.arc(e.x, e.y, e.r * (1 - p * 0.5), 0, 7);
          c.fill();
          break;
        case 'ring':
          c.globalAlpha = (1 - p) * 0.9;
          c.strokeStyle = e.col;
          c.lineWidth = 3 * (1 - p) + 0.5;
          c.beginPath();
          c.arc(e.x, e.y, e.r0 + (e.r1 - e.r0) * ease(p), 0, 7);
          c.stroke();
          break;
        case 'flash': {
          c.globalCompositeOperation = 'lighter';
          const g = c.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r);
          g.addColorStop(0, `rgba(255,240,200,${0.8 * (1 - p)})`);
          g.addColorStop(0.4, `rgba(255,201,60,${0.3 * (1 - p)})`);
          g.addColorStop(1, 'rgba(255,201,60,0)');
          c.fillStyle = g;
          c.fillRect(e.x - e.r, e.y - e.r, e.r * 2, e.r * 2);
          break;
        }
        case 'bolt': {
          c.globalCompositeOperation = 'lighter';
          const cx = e.x0 + (e.x1 - e.x0) * 0.2;
          const cy = e.y1 + (e.y0 - e.y1) * 0.35;
          const at = (q: number) => [(1 - q) ** 2 * e.x0 + 2 * (1 - q) * q * cx + q * q * e.x1, (1 - q) ** 2 * e.y0 + 2 * (1 - q) * q * cy + q * q * e.y1];
          const head = Math.min(1, ease(p * 1.6));
          const tail = Math.max(0, head - 0.45);
          const fadeA = p > 0.6 ? 1 - (p - 0.6) / 0.4 : 1;
          c.lineCap = 'round';
          for (let k = 0; k < 10; k++) {
            const [ax, ay] = at(tail + ((head - tail) * k) / 10);
            const [bx, by] = at(tail + ((head - tail) * (k + 1)) / 10);
            c.globalAlpha = (fadeA * (k + 1)) / 10;
            c.strokeStyle = COL.goldHi;
            c.lineWidth = 0.6 + (3.2 * (k + 1)) / 10;
            c.beginPath();
            c.moveTo(ax, ay);
            c.lineTo(bx, by);
            c.stroke();
          }
          const [hx, hy] = at(head);
          c.globalAlpha = fadeA;
          c.fillStyle = '#fff6dc';
          c.beginPath();
          c.arc(hx, hy, 3.5, 0, 7);
          c.fill();
          break;
        }
        case 'shatter': {
          const tt = t - e.t0;
          const f = e.f as FallWord;
          const cw = cellW(f);
          const gs = e.s * 0.84;
          const k = gs / 1024;
          c.globalAlpha = clamp(1 - p * 1.1, 0, 1);
          c.shadowColor = COL.gold;
          c.shadowBlur = 14 * dpr;
          c.fillStyle = tt < 0.1 ? '#fff6dc' : COL.gold;
          for (const q of e.parts) {
            const ox = q.vx * tt;
            const oy = q.vy * tt + 260 * tt * tt;
            const ccx = e.x - (f.chars.length * cw) / 2 + cw * (q.ci + 0.5) + ox;
            c.setTransform(dpr * k, 0, 0, -dpr * k, dpr * (ccx - gs / 2 + this.so[0]), dpr * (e.y + oy - gs / 2 + 900 * k + this.so[1]));
            c.translate(q.cx, 900 - q.cy);
            c.rotate(q.vr * tt);
            c.translate(-q.cx, -(900 - q.cy));
            c.fill(f.chars[q.ci].paths[q.i]);
          }
          c.shadowBlur = 0;
          break;
        }
        case 'label': {
          const tt = t - e.t0;
          const rise = ease(Math.min(1, tt / 1.2)) * 46;
          const a = tt < 0.15 ? tt / 0.15 : p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
          const y = e.y - rise;
          const w = e.w as Word;
          const lx = clamp(e.x, sky.x + 80, sky.x + sky.w - 80);
          c.globalAlpha = a;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.shadowColor = 'rgba(0,0,0,.8)';
          c.shadowBlur = 6 * dpr;
          if (e.miss) {
            c.font = '700 22px "Noto Sans SC", "PingFang SC", sans-serif';
            c.fillStyle = '#ffb3ad';
            c.fillText(w.h, lx, y - 18);
          } else {
            c.font = '400 16px "Lilita One", sans-serif';
            c.fillStyle = COL.goldHi;
            c.fillText(`+${e.gain}${e.perfect ? '  PERFECT' : ''}`, lx, y - 22);
          }
          c.font = '900 19px Nunito, system-ui, sans-serif';
          c.fillStyle = e.miss ? '#ffb3ad' : COL.gold;
          c.fillText(w.p, lx, y + 2);
          c.font = '500 12.5px Mitr, Nunito, sans-serif';
          c.fillStyle = 'rgba(243,234,215,.9)';
          let m = `${w.th}  ·  ${w.en}`;
          const maxW = sky.w - 24;
          while (m.length > 4 && c.measureText(m).width > maxW) m = m.slice(0, -2).trimEnd() + '…';
          c.fillText(m, clamp(e.x, sky.x + maxW / 2, sky.x + sky.w - maxW / 2), y + 22);
          c.shadowBlur = 0;
          break;
        }
      }
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
    }
  }
}
