/**
 * Vault cards, painted on canvas: rice paper, a dry-brush ensō, brush-script hanzi,
 * a carved vermilion seal and a frame that gets richer with rarity (ink → porcelain blue
 * → violet → gold foil → iridescent on black lacquer). Canvas so the same pixels feed the
 * WebGL flipper; all procedural noise is seeded per word, so redraws are identical.
 */
import type { Word } from '../../core/data';
import type { Lang } from '../../core/i18n';
import { RARITIES, rng, hash } from '../../core/rarity';
import { TAU } from '../../core/util';
import { INK } from '../../engine/sprites';
import { sizeCanvas, wrap } from '../quiz/cardFace';

export const F_BRUSH = '"Ma Shan Zheng", "Noto Serif SC", "STKaiti", "KaiTi", serif';
export const F_SERIF = '"Noto Serif SC", "Songti SC", serif';
export const F_SERIF_TH = '"Noto Serif Thai", Mitr, serif';
/** game display face — same as every label in the app */
export const F_LABEL = '"Lilita One", Nunito, system-ui, sans-serif';
/** Latin body text: Noto Serif SC's Latin, so English sits naturally beside the pinyin */
export const F_LATIN_SERIF = '"Noto Serif SC", Georgia, serif';

/** tier pill fills: [top, bottom] or foil stops */
export const TIER_FILL = [
  ['#e6e1ec', '#9a93a4'],
  ['#8fc0ff', '#2f6fe0'],
  ['#dcb0ff', '#8a3ee0'],
  ['#fff1b0', '#f2b53a', '#c7801c'],
  ['#ff9ec0', '#ffd36b', '#7cf0c8', '#7fb6ff', '#c79bff'],
];
export const CARD_RATIO = 1.42;

const GOLD = ['#fff5cc', '#e2aa3c', '#fff0b5', '#9e6614', '#f3cf73', '#fff9e0', '#b27b1e'];
const IRIS = ['#ffd3de', '#c8adff', '#a3ebff', '#c0ffd6', '#fff0a6', '#ffbfcc', '#b3a3ff'];

interface Art {
  paper: [string, string];
  ink: string;
  sub: string;
  /** [light, deep, mid] for plain frames; foil stops for foil frames */
  frame: string[];
  accent: string;
  /** rgb triplets for rgba() */
  enso: string;
  wash: string;
  dark: boolean;
  foil: boolean;
  flecks: number;
}

const ART: Art[] = [
  { paper: ['#f9f4ea', '#e9ddc6'], ink: '#1d1822', sub: '#6f6773', frame: ['#bdb6c4', '#6a6372', '#9a93a2'], accent: '#6a6372', enso: '29,24,34', wash: '120,110,130', dark: false, foil: false, flecks: 0 },
  { paper: ['#f7f8f9', '#dde6f1'], ink: '#111b31', sub: '#4a5876', frame: ['#8bb6ff', '#1b4db5', '#4f86ea'], accent: '#1f55c7', enso: '24,64,160', wash: '60,120,230', dark: false, foil: false, flecks: 0 },
  { paper: ['#f8f3fb', '#e6d8f2'], ink: '#1e1130', sub: '#69547f', frame: ['#dcb6ff', '#651bab', '#a24ef2'], accent: '#7a2dd0', enso: '92,28,160', wash: '170,90,255', dark: false, foil: false, flecks: 14 },
  { paper: ['#fcf5df', '#edd6a0'], ink: '#221308', sub: '#7a5a2e', frame: GOLD, accent: '#b3261e', enso: '160,28,22', wash: '230,160,40', dark: false, foil: true, flecks: 46 },
  { paper: ['#1e1628', '#09060e'], ink: '#f6e1a4', sub: '#c7b07c', frame: IRIS, accent: '#ff5a7a', enso: '255,214,140', wash: '255,61,99', dark: true, foil: true, flecks: 80 },
];

export interface CardInfo {
  level: number;
  /** collection number inside the level (1-based) */
  no: number;
}

// ------------------------------------------------------------------ primitives
function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

export function foilGradient(c: CanvasRenderingContext2D, w: number, h: number, stops: string[], shift = 0) {
  const g = c.createLinearGradient(-w * 0.2 + shift, 0, w * 1.2 + shift, h);
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  return g;
}

/** draw text with manual letter spacing (ctx.letterSpacing isn't everywhere yet) */
function spaced(c: CanvasRenderingContext2D, text: string, x: number, y: number, sp: number) {
  const chars = [...text];
  const widths = chars.map((ch) => c.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + sp * (chars.length - 1);
  const align = c.textAlign;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  c.textAlign = 'left';
  chars.forEach((ch, i) => {
    c.fillText(ch, cx, y);
    cx += widths[i] + sp;
  });
  c.textAlign = align;
  return total;
}

function paper(c: CanvasRenderingContext2D, w: number, h: number, a: Art, R: () => number, u: number) {
  const g = c.createLinearGradient(0, 0, w * 0.4, h);
  g.addColorStop(0, a.paper[0]);
  g.addColorStop(1, a.paper[1]);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  // fibres
  c.lineWidth = 0.6 * u;
  for (let i = 0; i < 240; i++) {
    const x = R() * w;
    const y = R() * h;
    const len = (6 + R() * 22) * u;
    const ang = R() * TAU;
    c.strokeStyle = a.dark ? `rgba(255,230,190,${0.02 + R() * 0.05})` : `rgba(120,90,50,${0.04 + R() * 0.08})`;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + Math.cos(ang + 1) * len * 0.5, y + Math.sin(ang + 1) * len * 0.5, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    c.stroke();
  }
  // speckles
  for (let i = 0; i < 380; i++) {
    c.fillStyle = a.dark ? `rgba(255,240,210,${R() * 0.07})` : `rgba(90,60,30,${R() * 0.08})`;
    c.fillRect(R() * w, R() * h, u * (0.6 + R()), u * (0.6 + R()));
  }
  // gold leaf flecks
  for (let i = 0; i < a.flecks; i++) {
    const x = R() * w;
    const y = R() * h;
    const s = (1 + R() * 3.2) * u;
    c.fillStyle = `rgba(${R() < 0.5 ? '240,196,84' : '255,232,160'},${0.35 + R() * 0.5})`;
    c.beginPath();
    c.moveTo(x - s, y);
    c.lineTo(x - s * 0.2, y - s * (0.6 + R()));
    c.lineTo(x + s, y - s * 0.2);
    c.lineTo(x + s * 0.3, y + s * (0.5 + R() * 0.6));
    c.closePath();
    c.fill();
  }
  // aged edges
  const v = c.createRadialGradient(w / 2, h * 0.42, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, a.dark ? 'rgba(0,0,0,.6)' : 'rgba(130,90,40,.26)');
  c.fillStyle = v;
  c.fillRect(0, 0, w, h);
}

/** 祥云 auspicious cloud: a curl with two trailing lobes */
export function cloud(c: CanvasRenderingContext2D, x: number, y: number, s: number, flip: number, color: string, lw: number) {
  c.save();
  c.translate(x, y);
  c.scale(flip * s, s);
  c.strokeStyle = color;
  c.lineWidth = lw / s;
  c.beginPath();
  c.arc(0, 0, 6, Math.PI * 0.1, Math.PI * 1.9);
  c.arc(-1.5, -1, 3, Math.PI * 1.9, Math.PI * 0.9, true);
  c.moveTo(6, 1);
  c.bezierCurveTo(12, 8, 22, 6, 24, 0);
  c.arc(19, 0, 5, 0, Math.PI, true);
  c.moveTo(-6, 2);
  c.bezierCurveTo(-10, 8, -18, 8, -22, 4);
  c.stroke();
  c.restore();
}

/** 回纹 fret corner */
function fret(c: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number, s: number) {
  c.beginPath();
  c.moveTo(x, y + s * sy);
  c.lineTo(x, y);
  c.lineTo(x + s * sx, y);
  c.moveTo(x + s * 0.28 * sx, y + s * 0.72 * sy);
  c.lineTo(x + s * 0.28 * sx, y + s * 0.28 * sy);
  c.lineTo(x + s * 0.72 * sx, y + s * 0.28 * sy);
  c.lineTo(x + s * 0.72 * sx, y + s * 0.52 * sy);
  c.lineTo(x + s * 0.5 * sx, y + s * 0.52 * sy);
  c.stroke();
}

function frame(c: CanvasRenderingContext2D, w: number, h: number, a: Art, R: number, u: number, shift = 0) {
  const o = 5 * u;
  const band = 9 * u;
  if (a.foil) {
    // foil band = outer rrect minus inner rrect
    c.save();
    c.beginPath();
    c.roundRect(o, o, w - o * 2, h - o * 2, R - o * 0.6);
    c.roundRect(o + band, o + band, w - (o + band) * 2, h - (o + band) * 2, R - o - band * 0.6);
    c.fillStyle = foilGradient(c, w, h, a.frame, shift);
    c.fill('evenodd');
    c.strokeStyle = a.dark ? 'rgba(255,230,170,.55)' : 'rgba(95,55,8,.7)';
    c.lineWidth = 1 * u;
    c.stroke();
    // engraved dots along the band
    c.fillStyle = a.dark ? 'rgba(30,10,40,.35)' : 'rgba(110,70,10,.35)';
    const step = 12 * u;
    for (let x = o + band + step; x < w - o - band - step / 2; x += step) {
      c.beginPath();
      c.arc(x, o + band / 2, 1.1 * u, 0, TAU);
      c.arc(x, h - o - band / 2, 1.1 * u, 0, TAU);
      c.fill();
    }
    c.restore();
  } else {
    c.strokeStyle = a.frame[1];
    c.lineWidth = 2.4 * u;
    rr(c, o + 2 * u, o + 2 * u, w - (o + 2 * u) * 2, h - (o + 2 * u) * 2, R - o);
    c.stroke();
  }
  // inner hairline + fret corners
  const m = (a.foil ? o + band + 5 * u : 15 * u);
  c.strokeStyle = a.foil ? (a.dark ? 'rgba(246,225,164,.7)' : 'rgba(150,100,30,.75)') : a.frame[2];
  c.lineWidth = 1 * u;
  rr(c, m, m, w - m * 2, h - m * 2, Math.max(2, R - m));
  c.stroke();
  c.lineWidth = 1.6 * u;
  const f = 16 * u;
  const q = m + 4 * u;
  fret(c, q, q, 1, 1, f);
  fret(c, w - q, q, -1, 1, f);
  fret(c, q, h - q, 1, -1, f);
  fret(c, w - q, h - q, -1, -1, f);
}

/**
 * Dry-brush ensō: a bundle of bristles swept round the circle, pressing hard at the start,
 * lifting and breaking up into dry streaks toward the tail.
 */
function enso(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, rgb: string, R: () => number, width: number) {
  const start = -Math.PI * 0.62 + (R() - 0.5) * 0.7;
  const sweep = TAU * (0.83 + R() * 0.08);
  const N = 30;
  const steps = 150;
  c.lineCap = 'round';
  for (let b = 0; b < N; b++) {
    const o = (b / (N - 1)) * 2 - 1;
    const endT = 1 - Math.abs(o) * 0.24 - R() * 0.1;
    const startT = R() * 0.02 + Math.abs(o) * 0.035;
    c.strokeStyle = `rgba(${rgb},${0.22 + R() * 0.4})`;
    c.lineWidth = (width / N) * 2.6 * (0.6 + R() * 0.8);
    c.beginPath();
    let pen = false;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (t < startT || t > endT || R() < t ** 3 * 0.4) {
        pen = false;
        continue;
      }
      const press = t < 0.07 ? 0.55 + (t / 0.07) * 0.45 : 1 - ((t - 0.07) / 0.93) ** 1.5 * 0.6;
      const ang = start + sweep * t;
      const rad = r + o * width * 0.5 * press + Math.sin(ang * 3 + b * 0.3) * width * 0.04;
      const x = cx + Math.cos(ang) * rad;
      const y = cy + Math.sin(ang) * rad * 0.97;
      if (!pen) {
        c.moveTo(x, y);
        pen = true;
      } else c.lineTo(x, y);
    }
    c.stroke();
  }
  // ink pools where the brush first touched down
  const sx = cx + Math.cos(start) * r;
  const sy = cy + Math.sin(start) * r;
  c.fillStyle = `rgba(${rgb},.22)`;
  c.beginPath();
  c.ellipse(sx, sy, width * 0.42, width * 0.3, start + Math.PI / 2, 0, TAU);
  c.fill();
}

function brushLine(c: CanvasRenderingContext2D, x0: number, x1: number, y: number, rgb: string, R: () => number, width: number) {
  const N = 14;
  const steps = 60;
  for (let b = 0; b < N; b++) {
    const o = (b / (N - 1)) * 2 - 1;
    c.strokeStyle = `rgba(${rgb},${0.18 + R() * 0.35})`;
    c.lineWidth = (width / N) * 2.4;
    c.beginPath();
    let pen = false;
    const endT = 1 - Math.abs(o) * 0.3 - R() * 0.08;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (t > endT || t < Math.abs(o) * 0.08 || R() < t ** 2 * 0.25) {
        pen = false;
        continue;
      }
      const press = 1 - t * 0.55;
      const x = x0 + (x1 - x0) * t;
      const yy = y + Math.sin(t * Math.PI) * -width * 0.5 + o * width * 0.5 * press;
      if (!pen) {
        c.moveTo(x, yy);
        pen = true;
      } else c.lineTo(x, yy);
    }
    c.stroke();
  }
}

const sealCache = new Map<string, HTMLCanvasElement>();

/** carved vermilion seal (朱文 border, 白文 glyphs), eroded edges */
function seal(chars: string, s: number, R: () => number, key: string) {
  const ck = `${key}:${chars}:${s}`;
  const hit = sealCache.get(ck);
  if (hit) return hit;
  const k = 3;
  const n = [...chars].length;
  const W = s;
  const H = s * (n > 1 ? 1.78 : 1);
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(W * k);
  cv.height = Math.ceil(H * k);
  const c = cv.getContext('2d')!;
  c.scale(k, k);
  c.fillStyle = '#c3272d';
  rr(c, 0, 0, W, H, s * 0.1);
  c.fill();
  c.strokeStyle = '#f7ecdc';
  c.lineWidth = s * 0.06;
  rr(c, s * 0.09, s * 0.09, W - s * 0.18, H - s * 0.18, s * 0.05);
  c.stroke();
  c.fillStyle = '#f7ecdc';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `${s * 0.58}px ${F_BRUSH}`;
  [...chars].forEach((ch, i) => c.fillText(ch, W / 2, n > 1 ? H * (i ? 0.7 : 0.31) : H * 0.53));
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 110; i++) {
    c.globalAlpha = 0.3 + R() * 0.7;
    c.beginPath();
    c.arc(R() * W, R() * H, R() * s * 0.028 + 0.2, 0, TAU);
    c.fill();
  }
  for (let i = 0; i < 26; i++) {
    const side = Math.floor(R() * 4);
    const t = R();
    const x = side === 0 ? t * W : side === 1 ? W : side === 2 ? t * W : 0;
    const y = side === 0 ? 0 : side === 1 ? t * H : side === 2 ? H : t * H;
    c.globalAlpha = 1;
    c.beginPath();
    c.arc(x, y, s * (0.02 + R() * 0.04), 0, TAU);
    c.fill();
  }
  sealCache.set(ck, cv);
  return cv;
}

export function fit(c: CanvasRenderingContext2D, text: string, font: (s: number) => string, max: number, maxW: number) {
  c.font = font(max);
  const m = c.measureText(text).width;
  const s = m > maxW ? Math.floor((max * maxW) / m) : max;
  c.font = font(s);
  return s;
}

/** the rarity badge: ink-outlined pill, rarity fill, outlined white label (the app's cartoon voice) */
export function tierPill(c: CanvasRenderingContext2D, r: number, x: number, y: number, u: number) {
  const name = RARITIES[r].name;
  c.font = `${12 * u}px ${F_LABEL}`;
  const tw = spaced(c, name, -9999, -9999, 0.8 * u);
  const pw = tw + 30 * u;
  const ph = 19 * u;
  const stops = TIER_FILL[r];
  const g = r === 4 ? c.createLinearGradient(x - pw / 2, 0, x + pw / 2, 0) : c.createLinearGradient(0, y - ph / 2, 0, y + ph / 2);
  stops.forEach((col, i) => g.addColorStop(i / (stops.length - 1), col));
  c.save();
  // drop slab
  c.fillStyle = INK;
  rr(c, x - pw / 2, y - ph / 2 + 2 * u, pw, ph, ph / 2);
  c.fill();
  c.fillStyle = g;
  rr(c, x - pw / 2, y - ph / 2, pw, ph, ph / 2);
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 1.8 * u;
  c.stroke();
  // gloss
  c.fillStyle = 'rgba(255,255,255,.45)';
  rr(c, x - pw / 2 + 6 * u, y - ph / 2 + 2.5 * u, pw - 12 * u, 3.5 * u, 2 * u);
  c.fill();
  // gems
  for (const dx of [-(pw / 2 - 8 * u), pw / 2 - 8 * u]) {
    c.beginPath();
    c.moveTo(x + dx, y - 3.2 * u);
    c.lineTo(x + dx + 2.6 * u, y);
    c.lineTo(x + dx, y + 3.2 * u);
    c.lineTo(x + dx - 2.6 * u, y);
    c.closePath();
    c.fillStyle = '#fff';
    c.fill();
    c.lineWidth = 1.2 * u;
    c.stroke();
  }
  // outlined label
  c.lineJoin = 'round';
  c.lineWidth = 3.2 * u;
  c.strokeStyle = INK;
  c.fillStyle = INK;
  const ty = y + 0.8 * u;
  strokeSpaced(c, name, x, ty, 0.8 * u);
  c.fillStyle = '#fff';
  spaced(c, name, x, ty, 0.8 * u);
  c.restore();
}

function strokeSpaced(c: CanvasRenderingContext2D, text: string, x: number, y: number, sp: number) {
  const chars = [...text];
  const widths = chars.map((ch) => c.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + sp * (chars.length - 1);
  let cx = x - total / 2;
  const align = c.textAlign;
  c.textAlign = 'left';
  chars.forEach((ch, i) => {
    c.strokeText(ch, cx, y);
    cx += widths[i] + sp;
  });
  c.textAlign = align;
}

// ------------------------------------------------------------------ faces
export function cardSize(w: number) {
  return { w: Math.round(w), h: Math.round(w * CARD_RATIO) };
}

export function drawCardFront(cv: HTMLCanvasElement, width: number, word: Word, rarity: number, info: CardInfo, lang: Lang) {
  const { w, h } = cardSize(width);
  const c = sizeCanvas(cv, w, h);
  const a = ART[rarity];
  const Rr = RARITIES[rarity];
  const u = w / 320;
  const R = rng(hash(`${info.level}:${word.h}`));
  const rad = 18 * u;

  c.save();
  rr(c, 0, 0, w, h, rad);
  c.clip();
  paper(c, w, h, a, R, u);

  // corner clouds
  const cc = a.foil ? (a.dark ? 'rgba(246,225,164,.35)' : 'rgba(170,110,30,.35)') : `rgba(${a.enso},.18)`;
  if (rarity >= 1) {
    cloud(c, 48 * u, 74 * u, 0.9 * u, 1, cc, 1.3 * u);
    cloud(c, w - 48 * u, 74 * u, 0.9 * u, -1, cc, 1.3 * u);
  }

  // ---- hanzi stage
  const cx = w / 2;
  const cy = h * 0.335;
  const er = w * 0.3;
  // ink wash
  for (let i = 0; i < 5; i++) {
    const x = cx + (R() - 0.5) * er * 0.9;
    const y = cy + (R() - 0.5) * er * 0.7;
    const r = er * (0.5 + R() * 0.6);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${a.wash},${a.dark ? 0.16 : 0.1})`);
    g.addColorStop(1, `rgba(${a.wash},0)`);
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  if (a.dark) {
    // radiant halo on black lacquer
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, er * 1.5);
    g.addColorStop(0, 'rgba(255,200,110,.28)');
    g.addColorStop(1, 'rgba(255,200,110,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  enso(c, cx, cy, er, a.enso, R, 20 * u);
  // splatter
  if (rarity >= 2) {
    for (let i = 0; i < 10 + rarity * 4; i++) {
      const ang = R() * TAU;
      const d = er * (1.08 + R() * 0.45);
      c.fillStyle = `rgba(${a.enso},${0.2 + R() * 0.45})`;
      c.beginPath();
      c.arc(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, (0.6 + R() * 2.2) * u, 0, TAU);
      c.fill();
    }
  }

  // hanzi
  const len = [...word.h].length;
  const hs = fit(c, word.h, (s) => `${s}px ${F_BRUSH}`, Math.min(len === 1 ? 168 * u : len === 2 ? 118 * u : 96 * u, h * 0.26), len === 1 ? w * 0.55 : w * 0.8);
  const hy = cy + hs * 0.04;
  let fill: string | CanvasGradient = a.ink;
  if (a.dark) {
    const g = c.createLinearGradient(0, cy - hs / 2, 0, cy + hs / 2);
    g.addColorStop(0, '#fff7d6');
    g.addColorStop(0.5, '#f2c75a');
    g.addColorStop(1, '#b0761c');
    fill = g;
  }
  c.save();
  c.shadowColor = a.dark ? 'rgba(255,180,70,.75)' : `rgba(${a.enso},.45)`;
  c.shadowBlur = hs * (a.dark ? 0.18 : 0.07);
  c.fillStyle = fill;
  c.fillText(word.h, cx, hy);
  c.restore();
  c.fillStyle = fill;
  c.fillText(word.h, cx, hy);

  // seal
  const ss = 26 * u;
  const sealCv = seal(Rr.zh, ss, R, String(rarity));
  const sx = cx + er * 0.8;
  const sy = cy + er * 0.72;
  c.save();
  c.translate(sx, sy);
  c.rotate(-0.05);
  c.globalAlpha = 0.92;
  c.drawImage(sealCv, -ss / 2, -(ss * 1.78) / 2, ss, ss * 1.78);
  c.restore();

  // ---- header: HSK · tier pill · No.
  const top = (a.foil ? 35 : 31) * u;
  c.font = `${11 * u}px ${F_LABEL}`;
  c.fillStyle = a.sub;
  c.textAlign = 'left';
  const side = (a.foil ? 48 : 42) * u;
  spaced(c, `HSK ${info.level}`, side, top, 0.6 * u);
  c.textAlign = 'right';
  spaced(c, `No.${String(info.no).padStart(3, '0')}`, w - side, top, 0.4 * u);
  c.textAlign = 'center';
  tierPill(c, rarity, cx, top, u);

  // ---- lower text block (shrink to fit)
  const pinY = cy + er + 22 * u;
  const bottom = h - (a.foil ? 30 : 26) * u;
  const padX = 30 * u;
  const maxW = w - padX * 2;
  const meaning = lang === 'th' ? word.th : word.en;
  const other = lang === 'th' ? word.en : word.th;
  const trans = lang === 'th' ? word.ex.th : word.ex.en;
  const fMain = lang === 'th' ? F_SERIF_TH : F_LATIN_SERIF;
  const fOther = lang === 'th' ? F_LATIN_SERIF : F_SERIF_TH;

  for (let k = 1; k > 0.5; k -= 0.05) {
    type Row = { font: string; color: string; lines: string[]; lh: number; gapBefore: number };
    const rows: Row[] = [];
    const add = (text: string, font: string, size: number, color: string, kind: 'zh' | 'th' | 'latin', gapBefore = 0, maxLines = 3) => {
      c.font = font.replace('{s}', (size * k).toFixed(1));
      rows.push({ font: c.font, color, lines: wrap(c, text, maxW - (kind === 'zh' ? 0 : 0), kind).slice(0, maxLines), lh: size * k * 1.3, gapBefore: gapBefore * k });
    };
    add(word.p, `500 {s}px ${F_SERIF}`, 21 * u, a.accent, 'latin');
    add(meaning, `700 {s}px ${fMain}`, (lang === 'th' ? 20 : 20) * u, a.ink, lang === 'th' ? 'th' : 'latin', 18 * u, 2);
    add(other, `${lang === 'th' ? 600 : 500} {s}px ${fOther}`, (lang === 'th' ? 14 : 12.5) * u, a.sub, lang === 'th' ? 'latin' : 'th', 1 * u, 2);
    add(word.ex.zh, `500 {s}px ${F_SERIF}`, 14 * u, a.ink, 'zh', 16 * u, 2);
    add(word.ex.py, `500 {s}px ${F_SERIF}`, 10.5 * u, a.accent, 'latin', 2 * u, 2);
    add(trans, `500 {s}px ${lang === 'th' ? F_SERIF_TH : F_LATIN_SERIF}`, (lang === 'th' ? 11.5 : 11.5) * u, a.sub, lang === 'th' ? 'th' : 'latin', 2 * u, 2);
    const total = rows.reduce((s, r) => s + r.gapBefore + r.lines.length * r.lh, 0);
    if (pinY - rows[0].lh / 2 + total <= bottom || k <= 0.55) {
      let y = pinY - rows[0].lh / 2;
      let exTop = 0;
      rows.forEach((r, i) => {
        y += r.gapBefore;
        if (i === 1) brushLine(c, cx - w * 0.2, cx + w * 0.2, y - r.gapBefore * 0.45, a.enso, R, 3.2 * u);
        if (i === 3) exTop = y - 7 * u;
        c.font = r.font;
        c.fillStyle = r.color;
        for (const line of r.lines) {
          c.fillText(line, cx, y + r.lh / 2);
          y += r.lh;
        }
      });
      // example cartouche
      const exH = y - exTop + 6 * u;
      c.strokeStyle = a.dark ? 'rgba(246,225,164,.28)' : `rgba(${a.enso},.22)`;
      c.lineWidth = 1 * u;
      rr(c, padX - 8 * u, exTop, maxW + 16 * u, exH, 8 * u);
      c.stroke();
      // tiny 例 tab
      c.fillStyle = a.dark ? '#c3272d' : a.accent;
      rr(c, cx - 8 * u, exTop - 7 * u, 16 * u, 14 * u, 3 * u);
      c.fill();
      c.font = `700 ${9.5 * u}px ${F_SERIF}`;
      c.fillStyle = '#fbf3e4';
      c.fillText('例', cx, exTop + 0.5 * u);
      break;
    }
  }
  c.restore();
  frame(c, w, h, a, rad, u);
  return cv;
}

export interface CosmeticFace {
  /** seeds the procedural noise (the item id) */
  key: string;
  /** the item's Chinese name */
  zh: string;
  /** its name in the current language */
  name: string;
  /** slot label, e.g. "FRAME" */
  kind: string;
}

/** where the live item sits on a cosmetic face: centre height and disc size, as fractions of the card */
export const COSMETIC_STAGE = { y: 0.335, d: 0.44 };

export function drawCardBack(cv: HTMLCanvasElement, width: number) {
  const { w, h } = cardSize(width);
  const c = sizeCanvas(cv, w, h);
  const u = w / 320;
  const R = rng(7);
  const rad = 18 * u;
  c.save();
  rr(c, 0, 0, w, h, rad);
  c.clip();
  const bg = c.createRadialGradient(w / 2, h * 0.46, 0, w / 2, h * 0.46, h * 0.7);
  bg.addColorStop(0, '#9c1a2c');
  bg.addColorStop(0.55, '#5e0a18');
  bg.addColorStop(1, '#2a030b');
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  // 海水纹 wave scales
  c.strokeStyle = 'rgba(255,205,110,.1)';
  c.lineWidth = 1.1 * u;
  const sr = 16 * u;
  for (let row = 0, y = 0; y < h + sr; row++, y += sr * 0.55) {
    for (let x = row % 2 ? sr : 0; x < w + sr; x += sr * 2) {
      for (const k of [1, 0.66, 0.33]) {
        c.beginPath();
        c.arc(x, y, sr * k, Math.PI, TAU);
        c.stroke();
      }
    }
  }
  // lacquer sheen
  const sh = c.createLinearGradient(0, 0, w, h);
  sh.addColorStop(0, 'rgba(255,255,255,.12)');
  sh.addColorStop(0.35, 'rgba(255,255,255,0)');
  sh.addColorStop(0.7, 'rgba(0,0,0,.15)');
  c.fillStyle = sh;
  c.fillRect(0, 0, w, h);
  // rays
  const cx = w / 2;
  const cy = h * 0.47;
  c.strokeStyle = 'rgba(255,215,130,.14)';
  c.lineWidth = 1.2 * u;
  for (let i = 0; i < 48; i++) {
    const ang = (i / 48) * TAU;
    c.beginPath();
    c.moveTo(cx + Math.cos(ang) * 70 * u, cy + Math.sin(ang) * 70 * u);
    c.lineTo(cx + Math.cos(ang) * h, cy + Math.sin(ang) * h);
    c.stroke();
  }
  // medallion
  const mr = 62 * u;
  const halo = c.createRadialGradient(cx, cy, mr * 0.6, cx, cy, mr * 1.9);
  halo.addColorStop(0, 'rgba(255,200,90,.45)');
  halo.addColorStop(1, 'rgba(255,200,90,0)');
  c.fillStyle = halo;
  c.fillRect(0, 0, w, h);
  c.fillStyle = foilGradient(c, w, h, GOLD);
  c.beginPath();
  c.arc(cx, cy, mr, 0, TAU);
  c.fill();
  c.strokeStyle = 'rgba(90,45,5,.85)';
  c.lineWidth = 1.6 * u;
  c.stroke();
  c.beginPath();
  c.arc(cx, cy, mr * 0.84, 0, TAU);
  c.stroke();
  c.fillStyle = '#7a0d1d';
  c.beginPath();
  c.arc(cx, cy, mr * 0.8, 0, TAU);
  c.fill();
  // ring of tiny studs
  c.fillStyle = 'rgba(90,45,5,.6)';
  for (let i = 0; i < 28; i++) {
    const ang = (i / 28) * TAU;
    c.beginPath();
    c.arc(cx + Math.cos(ang) * mr * 0.92, cy + Math.sin(ang) * mr * 0.92, 1.3 * u, 0, TAU);
    c.fill();
  }
  c.font = `${mr * 1.05}px ${F_BRUSH}`;
  c.fillStyle = foilGradient(c, w, h, GOLD, w * 0.1);
  c.shadowColor = 'rgba(0,0,0,.45)';
  c.shadowBlur = 6 * u;
  c.fillText('宝', cx, cy + mr * 0.05);
  c.shadowBlur = 0;
  // clouds
  const gc = 'rgba(255,214,130,.55)';
  cloud(c, cx - mr - 26 * u, cy + mr * 0.9, 1.3 * u, 1, gc, 1.6 * u);
  cloud(c, cx + mr + 26 * u, cy - mr * 0.9, 1.3 * u, -1, gc, 1.6 * u);
  // titles
  c.fillStyle = foilGradient(c, w, h, GOLD);
  c.font = `700 ${15 * u}px ${F_SERIF}`;
  spaced(c, '汉字宝库', cx, 44 * u, 9 * u);
  c.font = `${12 * u}px ${F_LABEL}`;
  spaced(c, 'HANZI RUSH', cx, h - 42 * u, 3 * u);
  void R;
  c.restore();
  frame(c, w, h, { ...ART[3], dark: false }, rad, u);
  return cv;
}

/** fonts must be loaded before painting to canvas (Google Fonts slices CJK by unicode-range) */
export function loadCardFonts(words: Word[]) {
  const zh = words.map((w) => w.h + w.ex.zh).join('') + '汉字宝库普通稀有史诗传说神话例';
  const latin = words.map((w) => w.p + w.ex.py + w.en + w.ex.en).join('') + 'HSKNo.0123456789COMMONRAREEPICLEGENDARYMYTHIC';
  const th = words.map((w) => w.th + w.ex.th).join('');
  return Promise.race([
    Promise.all([
      document.fonts.load(`40px "Ma Shan Zheng"`, zh),
      document.fonts.load(`500 20px "Noto Serif SC"`, zh + latin),
      document.fonts.load(`700 20px "Noto Serif SC"`, '汉字宝库例'),
      document.fonts.load(`20px "Lilita One"`, latin),
      document.fonts.load(`700 20px "Noto Serif SC"`, latin),
      document.fonts.load(`700 20px "Noto Serif Thai"`, th || 'ก'),
      document.fonts.load(`500 20px "Noto Serif Thai"`, th || 'ก'),
    ]),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
}

const ensoTex = new Map<number, string>();
/** a small ensō per rarity, as an image, for the CSS mini cards */
export function ensoTexture(r: number) {
  let url = ensoTex.get(r);
  if (url) return url;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 180;
  const c = cv.getContext('2d')!;
  enso(c, 90, 90, 64, ART[r].enso, rng(101 + r * 7), 15);
  url = cv.toDataURL('image/png');
  ensoTex.set(r, url);
  return url;
}
