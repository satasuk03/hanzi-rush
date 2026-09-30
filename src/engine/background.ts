/** Animated cartoon backdrop: rotating sunburst, drifting clouds, floating lanterns, twinkles. */
import gsap from 'gsap';
import { rand, TAU, mixHex } from '../core/util';
import { INK } from './sprites';

interface Theme { a: string; b: string; glow: string; cloud: string; }

export const THEMES = {
  home: { a: '#3fa9f5', b: '#58b9fa', glow: '#dff4ff', cloud: '#ffffff' },
  play: { a: '#e8344e', b: '#f4495f', glow: '#ffd3a8', cloud: '#ffe9ec' },
  hot: { a: '#ff5a1f', b: '#ff7a2f', glow: '#fff0a0', cloud: '#fff1e0' },
  fever: { a: '#ffae00', b: '#ffc82e', glow: '#fffbe0', cloud: '#fff8dc' },
  results: { a: '#7b4dff', b: '#8f66ff', glow: '#f0e6ff', cloud: '#f5efff' },
} satisfies Record<string, Theme>;
export type ThemeName = keyof typeof THEMES;

interface Lantern { x: number; y: number; s: number; vy: number; phase: number; }
interface Cloud { x: number; y: number; s: number; v: number; }
interface Twinkle { x: number; y: number; phase: number; s: number; }

function lanternSprite() {
  const cv = document.createElement('canvas');
  cv.width = 120;
  cv.height = 180;
  const c = cv.getContext('2d')!;
  c.translate(60, 80);
  c.lineWidth = 6;
  c.strokeStyle = INK;
  c.lineJoin = 'round';
  // string
  c.beginPath();
  c.moveTo(0, -78);
  c.lineTo(0, -52);
  c.stroke();
  // caps
  c.fillStyle = '#ffc93c';
  c.beginPath();
  c.roundRect(-22, -56, 44, 14, 5);
  c.fill();
  c.stroke();
  c.beginPath();
  c.roundRect(-22, 40, 44, 14, 5);
  c.fill();
  c.stroke();
  // body
  c.fillStyle = '#ff3b4f';
  c.beginPath();
  c.ellipse(0, 0, 44, 46, 0, 0, TAU);
  c.fill();
  c.stroke();
  // ribs
  c.strokeStyle = '#c21d33';
  c.lineWidth = 4;
  for (const k of [-0.5, 0, 0.5]) {
    c.beginPath();
    c.ellipse(0, 0, 44 * Math.abs(k) + 2, 44, 0, -Math.PI / 2, Math.PI / 2, k < 0);
    c.stroke();
  }
  // shine
  c.fillStyle = 'rgba(255,255,255,.55)';
  c.beginPath();
  c.ellipse(-20, -16, 7, 14, 0.3, 0, TAU);
  c.fill();
  // tassel
  c.strokeStyle = INK;
  c.lineWidth = 6;
  c.fillStyle = '#ffc93c';
  c.beginPath();
  c.moveTo(-8, 54);
  c.lineTo(8, 54);
  c.lineTo(11, 92);
  c.lineTo(-11, 92);
  c.closePath();
  c.fill();
  c.stroke();
  return cv;
}

function cloudSprite(color: string) {
  const cv = document.createElement('canvas');
  cv.width = 320;
  cv.height = 160;
  const c = cv.getContext('2d')!;
  const blobs = [
    [80, 100, 52], [140, 76, 64], [210, 90, 56], [255, 110, 40], [50, 118, 34],
  ];
  const shape = (pad: number) => {
    c.beginPath();
    for (const [x, y, r] of blobs) {
      c.moveTo(x + r + pad, y);
      c.arc(x, y, r + pad, 0, TAU);
    }
    c.rect(40 - pad, 110 - pad, 230 + pad * 2, 36 + pad * 2);
  };
  c.fillStyle = INK;
  shape(5);
  c.fill();
  c.fillStyle = color;
  shape(0);
  c.fill();
  c.fillStyle = 'rgba(0,0,0,.07)';
  c.fillRect(40, 132, 230, 14);
  return cv;
}

class Background {
  private cv!: HTMLCanvasElement;
  private c!: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private t = 0;
  private rot = 0;
  /** current & target colours; `mix` tweens 0→1 between them */
  private from: Theme = THEMES.home;
  private to: Theme = THEMES.home;
  private mix = { v: 1 };
  /** ray spin speed rad/s — pumped by gameplay */
  speed = { v: 0.08 };
  private pulse = { v: 0 };
  private lanterns: Lantern[] = [];
  private clouds: Cloud[] = [];
  private twinkles: Twinkle[] = [];
  private lantern = lanternSprite();
  private cloudImg = cloudSprite('#ffffff');
  private cloudColor = '#ffffff';

  mount(cv: HTMLCanvasElement) {
    this.cv = cv;
    this.c = cv.getContext('2d')!;
    this.resize();
    addEventListener('resize', () => this.resize());
    for (let i = 0; i < 6; i++) this.lanterns.push(this.newLantern(true));
    for (let i = 0; i < 5; i++) this.clouds.push({ x: rand(-0.2, 1.1), y: rand(0.08, 0.5), s: rand(0.35, 0.7), v: rand(0.006, 0.018) });
    for (let i = 0; i < 26; i++) this.twinkles.push({ x: Math.random(), y: Math.random(), phase: rand(0, TAU), s: rand(2, 5) });
  }

  private newLantern(initial = false): Lantern {
    return { x: rand(0.04, 0.96), y: initial ? rand(0.1, 1.1) : 1.15, s: rand(0.28, 0.5), vy: rand(0.012, 0.03), phase: rand(0, TAU) };
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.w = innerWidth;
    this.h = innerHeight;
    this.cv.width = this.w * this.dpr;
    this.cv.height = this.h * this.dpr;
  }

  setTheme(name: ThemeName, dur = 0.8) {
    const cur = this.current();
    this.from = cur;
    this.to = THEMES[name];
    this.mix.v = 0;
    gsap.to(this.mix, { v: 1, duration: dur, ease: 'power2.inOut' });
    if (this.to.cloud !== this.cloudColor) {
      this.cloudColor = this.to.cloud;
      this.cloudImg = cloudSprite(this.cloudColor);
    }
  }

  /** a quick brightness pump + spin kick, e.g. on correct answers */
  kick(power = 1) {
    this.pulse.v = Math.min(1, this.pulse.v + 0.5 * power);
    gsap.to(this.pulse, { v: 0, duration: 0.6, ease: 'power2.out', overwrite: true });
    this.rot += 0.12 * power;
  }

  private current(): Theme {
    const m = this.mix.v;
    const f = this.from;
    const t = this.to;
    if (m >= 1) return t;
    const hex = (a: string, b: string) => {
      const rgb = mixHex(a, b, m).match(/\d+/g)!.map(Number);
      return '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('');
    };
    return { a: hex(f.a, t.a), b: hex(f.b, t.b), glow: hex(f.glow, t.glow), cloud: t.cloud };
  }

  update(dt: number) {
    this.t += dt;
    this.rot += this.speed.v * dt;
    for (const l of this.lanterns) {
      l.y -= l.vy * dt;
      if (l.y < -0.2) Object.assign(l, this.newLantern());
    }
    for (const cl of this.clouds) {
      cl.x += cl.v * dt;
      if (cl.x > 1.25) {
        cl.x = -0.4;
        cl.y = rand(0.08, 0.5);
      }
    }
  }

  render() {
    const { c, w, h, dpr } = this;
    const th = this.current();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = w / 2;
    const cy = h * 0.32;
    const R = Math.hypot(w, h);

    c.fillStyle = th.a;
    c.fillRect(0, 0, w, h);

    // sunburst
    const N = 18;
    c.fillStyle = th.b;
    c.beginPath();
    for (let i = 0; i < N; i++) {
      const a0 = this.rot + (i / N) * TAU;
      const a1 = a0 + TAU / N / 2;
      c.moveTo(cx, cy);
      c.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
      c.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R);
      c.closePath();
    }
    c.fill();

    // center glow
    const gr = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.6);
    gr.addColorStop(0, th.glow);
    gr.addColorStop(0.35, hexA(th.glow, 0.35 + this.pulse.v * 0.4));
    gr.addColorStop(1, hexA(th.glow, 0));
    c.fillStyle = gr;
    c.fillRect(0, 0, w, h);

    // twinkles
    for (const s of this.twinkles) {
      const a = 0.5 + 0.5 * Math.sin(this.t * 2.4 + s.phase);
      c.globalAlpha = a * 0.8;
      c.fillStyle = '#fff';
      const x = s.x * w;
      const y = s.y * h * 0.8;
      const r = s.s * (0.6 + a * 0.6);
      c.beginPath();
      c.moveTo(x, y - r * 2);
      c.quadraticCurveTo(x, y, x + r * 2, y);
      c.quadraticCurveTo(x, y, x, y + r * 2);
      c.quadraticCurveTo(x, y, x - r * 2, y);
      c.quadraticCurveTo(x, y, x, y - r * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    // clouds (far)
    for (const cl of this.clouds) {
      const s = cl.s * Math.min(1.3, w / 500 + 0.5);
      c.drawImage(this.cloudImg, cl.x * w - 160 * s, cl.y * h - 80 * s, 320 * s, 160 * s);
    }
    c.globalAlpha = 1;

    // lanterns
    for (const l of this.lanterns) {
      const s = l.s * Math.min(1.2, w / 520 + 0.45);
      const sway = Math.sin(this.t * 1.3 + l.phase) * 0.12;
      const x = l.x * w + Math.sin(this.t * 0.7 + l.phase) * 16;
      const y = l.y * h;
      c.setTransform(dpr * Math.cos(sway) * s, dpr * Math.sin(sway) * s, -dpr * Math.sin(sway) * s, dpr * Math.cos(sway) * s, x * dpr, y * dpr);
      c.drawImage(this.lantern, -60, -2);
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ground clouds band
    const bw = 320 * 0.9;
    const off = (this.t * 12) % bw;
    for (let x = -bw + off - 40; x < w + bw; x += bw * 0.72) {
      c.drawImage(this.cloudImg, x, h - 110, bw, 144);
    }

    // vignette
    const vg = c.createRadialGradient(cx, h * 0.45, Math.min(w, h) * 0.35, cx, h * 0.45, R * 0.7);
    vg.addColorStop(0, 'rgba(20,0,30,0)');
    vg.addColorStop(1, 'rgba(20,0,30,.38)');
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
  }
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export const background = new Background();
