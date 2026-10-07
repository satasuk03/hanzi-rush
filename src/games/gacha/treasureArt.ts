/**
 * Cosmetic reward faces: treasures out of a chest, not word cards. The face is a lacquered display case (玄漆 frame,
 * 包角 corner mounts) with an arched velvet alcove in the rarity colour, a spotlight and a silk cushion; the live item
 * sits on the cushion at COSMETIC_STAGE (the ceremony lays it over the canvas). A gilt nameplate (匾) carries the
 * Chinese name. The back is the lid of the chest it came out of (chest.ts tints) with the 海棠 lock plate.
 */
import type { Lang } from '../../core/i18n';
import { RARITIES, rng, hash } from '../../core/rarity';
import { TAU } from '../../core/util';
import { INK } from '../../engine/sprites';
import { sizeCanvas, wrap } from '../quiz/cardFace';
import { cardSize, cloud, fit, foilGradient, tierPill, COSMETIC_STAGE, F_BRUSH, F_LABEL, F_LATIN_SERIF, F_SERIF_TH, type CosmeticFace } from './cardArt';
import { boxTint } from './chest';

const GOLD = ['#fff5cc', '#e2aa3c', '#fff0b5', '#9e6614', '#f3cf73', '#fff9e0', '#b27b1e'];
const SILVER = ['#ffffff', '#c3ccd9', '#f4f7fb', '#7d8aa0', '#dde4ee', '#ffffff', '#98a4b8'];
const PEWTER = ['#efeaf3', '#a59db1', '#e3dde9', '#6c6479', '#c5bdd0', '#f2eef6', '#857c92'];
const IRIS = ['#ffd3de', '#c8adff', '#a3ebff', '#c0ffd6', '#fff0a6', '#ffbfcc', '#b3a3ff'];

interface Case {
  /** velvet: lit centre, mid, deep edge */
  velvet: [string, string, string];
  /** brocade lattice colour (rgb) */
  brocade: string;
  /** foil stops for the mounts, rims and nameplate */
  metal: string[];
  /** silk cushion: light, deep */
  silk: [string, string];
  /** gilt rays behind the item */
  rays: number;
}

const CASES: Case[] = [
  { velvet: ['#a49cb2', '#6a6178', '#2f2839'], brocade: '255,255,255', metal: PEWTER, silk: ['#e2525d', '#8a1424'], rays: 0 },
  { velvet: ['#6aa6ff', '#2459c4', '#0b1f5c'], brocade: '190,220,255', metal: SILVER, silk: ['#e2525d', '#8a1424'], rays: 0 },
  { velvet: ['#c98bff', '#7a2dd0', '#2a0b55'], brocade: '230,200,255', metal: GOLD, silk: ['#e2525d', '#8a1424'], rays: 10 },
  { velvet: ['#ff6a4f', '#b3161f', '#3d0510'], brocade: '255,214,140', metal: GOLD, silk: ['#ffe58a', '#c98516'], rays: 16 },
  { velvet: ['#5a3a86', '#24123f', '#08040f'], brocade: '255,200,230', metal: IRIS, silk: ['#ffe58a', '#c98516'], rays: 24 },
];

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

/** the lacquer field behind everything, with a diagonal sheen */
function lacquer(c: CanvasRenderingContext2D, w: number, h: number, stops: [string, string, string]) {
  const g = c.createLinearGradient(0, 0, w * 0.35, h);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.45, stops[1]);
  g.addColorStop(1, stops[2]);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  const sh = c.createLinearGradient(0, 0, w, h * 0.7);
  sh.addColorStop(0, 'rgba(255,255,255,.14)');
  sh.addColorStop(0.3, 'rgba(255,255,255,0)');
  sh.addColorStop(0.75, 'rgba(0,0,0,.18)');
  c.fillStyle = sh;
  c.fillRect(0, 0, w, h);
}

/** an L-shaped 包角 mount with a ruyi tip, ink-outlined, pointing into the corner (sx, sy) */
function mount(c: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number, s: number, fill: string | CanvasGradient, u: number) {
  c.save();
  c.translate(x, y);
  c.scale(sx, sy);
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(s, 0);
  c.quadraticCurveTo(s * 0.96, s * 0.3, s * 0.68, s * 0.32);
  c.quadraticCurveTo(s * 0.34, s * 0.32, s * 0.32, s * 0.58);
  c.quadraticCurveTo(s * 0.3, s * 0.94, 0, s);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 2 * u;
  c.lineJoin = 'round';
  c.stroke();
  // a stud in the bend
  c.beginPath();
  c.arc(s * 0.17, s * 0.17, s * 0.07, 0, TAU);
  c.fillStyle = 'rgba(42,26,58,.55)';
  c.fill();
  c.restore();
}

/** a 回纹 meander band between x0 and x1, centred on y */
function meander(c: CanvasRenderingContext2D, x0: number, x1: number, y: number, s: number, color: string | CanvasGradient, lw: number) {
  c.save();
  c.strokeStyle = color;
  c.lineWidth = lw;
  c.lineCap = 'square';
  const n = Math.floor((x1 - x0) / s);
  const off = x0 + (x1 - x0 - n * s) / 2;
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const x = off + i * s;
    const t = y - s / 2;
    c.moveTo(x + s * 0.08, y + s * 0.42);
    c.lineTo(x + s * 0.08, t + s * 0.08);
    c.lineTo(x + s * 0.88, t + s * 0.08);
    c.lineTo(x + s * 0.88, t + s * 0.88);
    c.lineTo(x + s * 0.36, t + s * 0.88);
    c.lineTo(x + s * 0.36, t + s * 0.36);
    c.lineTo(x + s * 0.62, t + s * 0.36);
    c.lineTo(x + s * 0.62, t + s * 0.62);
  }
  c.stroke();
  c.restore();
}

/** the alcove outline: straight sides, a 壸门 ogee arch rising to a cusp */
function alcove(c: CanvasRenderingContext2D, x0: number, x1: number, top: number, shoulder: number, bottom: number, r: number) {
  const cx = (x0 + x1) / 2;
  const half = (x1 - x0) / 2;
  c.beginPath();
  c.moveTo(x0 + r, bottom);
  c.quadraticCurveTo(x0, bottom, x0, bottom - r);
  c.lineTo(x0, shoulder);
  c.bezierCurveTo(x0, shoulder - (shoulder - top) * 0.55, cx - half * 0.55, shoulder - (shoulder - top) * 0.35, cx - half * 0.16, top + (shoulder - top) * 0.3);
  c.quadraticCurveTo(cx - half * 0.04, top + (shoulder - top) * 0.18, cx, top);
  c.quadraticCurveTo(cx + half * 0.04, top + (shoulder - top) * 0.18, cx + half * 0.16, top + (shoulder - top) * 0.3);
  c.bezierCurveTo(cx + half * 0.55, shoulder - (shoulder - top) * 0.35, x1, shoulder - (shoulder - top) * 0.55, x1, shoulder);
  c.lineTo(x1, bottom - r);
  c.quadraticCurveTo(x1, bottom, x1 - r, bottom);
  c.closePath();
}

/** the silk cushion the item rests on: a puffed top, a front skirt, gold piping and corner tassels */
function cushion(c: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, depth: number, silk: [string, string], metal: CanvasGradient, u: number) {
  // shadow on the velvet
  c.fillStyle = 'rgba(0,0,0,.35)';
  c.beginPath();
  c.ellipse(cx, cy + depth + ry * 0.55, rx * 1.02, ry * 0.7, 0, 0, TAU);
  c.fill();
  // skirt
  const sk = c.createLinearGradient(0, cy, 0, cy + depth + ry);
  sk.addColorStop(0, silk[0]);
  sk.addColorStop(1, silk[1]);
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI);
  c.lineTo(cx - rx, cy);
  c.ellipse(cx, cy + depth, rx, ry, 0, Math.PI, 0, true);
  c.closePath();
  c.fillStyle = sk;
  c.fill();
  c.beginPath();
  c.moveTo(cx - rx, cy);
  c.lineTo(cx - rx, cy + depth);
  c.ellipse(cx, cy + depth, rx, ry, 0, Math.PI, 0, true);
  c.lineTo(cx + rx, cy);
  c.strokeStyle = INK;
  c.lineWidth = 2.4 * u;
  c.stroke();
  // pleats on the skirt
  c.strokeStyle = 'rgba(60,0,10,.28)';
  c.lineWidth = 1.2 * u;
  for (let i = -3; i <= 3; i++) {
    const x = cx + (i / 3.6) * rx;
    const yy = cy + Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2)) * ry;
    c.beginPath();
    c.moveTo(x, yy + 2 * u);
    c.lineTo(x, yy + depth - 1 * u);
    c.stroke();
  }
  // top
  const tg = c.createRadialGradient(cx - rx * 0.25, cy - ry * 0.5, 0, cx, cy, rx);
  tg.addColorStop(0, '#fff');
  tg.addColorStop(0.18, silk[0]);
  tg.addColorStop(1, silk[1]);
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  c.fillStyle = tg;
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 2.4 * u;
  c.stroke();
  // gold piping
  c.beginPath();
  c.ellipse(cx, cy, rx * 0.86, ry * 0.72, 0, 0, TAU);
  c.strokeStyle = metal;
  c.lineWidth = 1.8 * u;
  c.stroke();
  // tassels at the ends
  for (const s of [-1, 1]) {
    const x = cx + s * rx * 0.97;
    const y = cy + depth * 0.4;
    c.fillStyle = metal;
    c.strokeStyle = INK;
    c.lineWidth = 1.6 * u;
    c.beginPath();
    c.arc(x, y, 3.4 * u, 0, TAU);
    c.fill();
    c.stroke();
    c.beginPath();
    c.moveTo(x - 3.2 * u, y + 3 * u);
    c.lineTo(x + 3.2 * u, y + 3 * u);
    c.lineTo(x + 4.6 * u, y + 19 * u);
    c.lineTo(x - 4.6 * u, y + 19 * u);
    c.closePath();
    c.fill();
    c.stroke();
  }
}

/** a 匾 nameplate: a gilt board with stepped ends, ink outline */
function plaque(c: CanvasRenderingContext2D, cx: number, cy: number, pw: number, ph: number, fill: CanvasGradient, u: number) {
  const x0 = cx - pw / 2;
  const x1 = cx + pw / 2;
  const y0 = cy - ph / 2;
  const y1 = cy + ph / 2;
  const n = 7 * u;
  const path = () => {
    c.beginPath();
    c.moveTo(x0 + n, y0);
    c.lineTo(x1 - n, y0);
    c.lineTo(x1 - n, y0 + n * 0.6);
    c.lineTo(x1, y0 + n * 0.6);
    c.lineTo(x1, y1 - n * 0.6);
    c.lineTo(x1 - n, y1 - n * 0.6);
    c.lineTo(x1 - n, y1);
    c.lineTo(x0 + n, y1);
    c.lineTo(x0 + n, y1 - n * 0.6);
    c.lineTo(x0, y1 - n * 0.6);
    c.lineTo(x0, y0 + n * 0.6);
    c.lineTo(x0 + n, y0 + n * 0.6);
    c.closePath();
  };
  // drop slab
  c.save();
  c.translate(0, 3 * u);
  path();
  c.fillStyle = INK;
  c.fill();
  c.restore();
  path();
  c.fillStyle = fill;
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 2.4 * u;
  c.lineJoin = 'round';
  c.stroke();
  // inner engraved line and a gloss
  c.strokeStyle = 'rgba(90,50,5,.45)';
  c.lineWidth = 1 * u;
  rr(c, x0 + n + 3 * u, y0 + 4 * u, pw - n * 2 - 6 * u, ph - 8 * u, 2 * u);
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,.4)';
  rr(c, x0 + n + 4 * u, y0 + 2.5 * u, pw - n * 2 - 8 * u, 3 * u, 1.5 * u);
  c.fill();
}

/** the card's outer rim: an inset metal fillet with ink either side, and four corner mounts */
function rim(c: CanvasRenderingContext2D, w: number, h: number, metal: CanvasGradient, rad: number, u: number) {
  const o = 7 * u;
  c.strokeStyle = INK;
  c.lineWidth = 6 * u;
  rr(c, o, o, w - o * 2, h - o * 2, rad - o * 0.6);
  c.stroke();
  c.strokeStyle = metal;
  c.lineWidth = 3 * u;
  c.stroke();
  const s = 30 * u;
  const m = 3 * u;
  mount(c, m, m, 1, 1, s, metal, u);
  mount(c, w - m, m, -1, 1, s, metal, u);
  mount(c, m, h - m, 1, -1, s, metal, u);
  mount(c, w - m, h - m, -1, -1, s, metal, u);
}

export function drawTreasureFront(cv: HTMLCanvasElement, width: number, rarity: number, f: CosmeticFace, lang: Lang) {
  const { w, h } = cardSize(width);
  const c = sizeCanvas(cv, w, h);
  const k = CASES[rarity];
  const Rr = RARITIES[rarity];
  const u = w / 320;
  const R = rng(hash(f.key));
  const rad = 18 * u;
  const metal = foilGradient(c, w, h, k.metal);
  const cx = w / 2;
  const sy = h * COSMETIC_STAGE.y;
  const disc = w * COSMETIC_STAGE.d;

  c.save();
  rr(c, 0, 0, w, h, rad);
  c.clip();
  lacquer(c, w, h, ['#3e2a4f', '#22142f', '#0f0717']);

  // ---- the alcove
  const ax0 = 26 * u;
  const ax1 = w - 26 * u;
  const aTop = 40 * u;
  const aShoulder = 104 * u;
  const aBottom = sy + disc / 2 + 62 * u;
  c.save();
  alcove(c, ax0, ax1, aTop, aShoulder, aBottom, 10 * u);
  c.clip();
  const vg = c.createRadialGradient(cx, sy - disc * 0.1, 0, cx, sy, (aBottom - aTop) * 0.9);
  vg.addColorStop(0, k.velvet[0]);
  vg.addColorStop(0.45, k.velvet[1]);
  vg.addColorStop(1, k.velvet[2]);
  c.fillStyle = vg;
  c.fillRect(0, 0, w, h);
  // 锦 brocade: a diagonal lattice with a tiny four-petal flower in each cell
  const cell = 22 * u;
  c.strokeStyle = `rgba(${k.brocade},.07)`;
  c.lineWidth = 1 * u;
  c.beginPath();
  for (let d = -h; d < w + h; d += cell) {
    c.moveTo(d, 0);
    c.lineTo(d + h, h);
    c.moveTo(d, h);
    c.lineTo(d + h, 0);
  }
  c.stroke();
  c.fillStyle = `rgba(${k.brocade},.09)`;
  for (let y = 0, row = 0; y < h; y += cell / 2, row++) {
    for (let x = row % 2 ? cell / 2 : 0; x < w; x += cell) {
      for (let p = 0; p < 4; p++) {
        const a = (p / 4) * TAU;
        c.beginPath();
        c.arc(x + Math.cos(a) * 2.2 * u, y + 0 + Math.sin(a) * 2.2 * u, 1.5 * u, 0, TAU);
        c.fill();
      }
    }
  }
  // rays for the precious tiers
  if (k.rays) {
    for (let i = 0; i < k.rays; i++) {
      const a = (i / k.rays) * TAU + R() * 0.04;
      const g = c.createLinearGradient(cx, sy, cx + Math.cos(a) * w * 0.7, sy + Math.sin(a) * w * 0.7);
      const col = rarity === 4 ? IRIS[i % IRIS.length] : '#ffe08a';
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.globalAlpha = rarity === 4 ? 0.3 : 0.22;
      c.beginPath();
      c.moveTo(cx, sy);
      c.arc(cx, sy, w * 0.75, a - 0.07, a + 0.07);
      c.closePath();
      c.fill();
    }
    c.globalAlpha = 1;
  }
  // spotlight from the top of the arch, and a halo behind the item
  const sp = c.createLinearGradient(0, aTop, 0, aBottom);
  sp.addColorStop(0, 'rgba(255,250,230,.38)');
  sp.addColorStop(1, 'rgba(255,250,230,0)');
  c.fillStyle = sp;
  c.beginPath();
  c.moveTo(cx - 16 * u, aTop);
  c.lineTo(cx + 16 * u, aTop);
  c.lineTo(cx + disc * 0.78, aBottom);
  c.lineTo(cx - disc * 0.78, aBottom);
  c.closePath();
  c.fill();
  const halo = c.createRadialGradient(cx, sy, disc * 0.3, cx, sy, disc * 0.95);
  halo.addColorStop(0, Rr.glow);
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  c.globalAlpha = 0.55;
  c.fillStyle = halo;
  c.fillRect(0, 0, w, h);
  c.globalAlpha = 1;
  // motes in the light
  for (let i = 0; i < 8 + rarity * 6; i++) {
    const x = cx + (R() - 0.5) * disc * 1.5;
    const y = aTop + 20 * u + R() * (aBottom - aTop - 40 * u);
    c.fillStyle = `rgba(255,248,220,${0.25 + R() * 0.5})`;
    c.beginPath();
    c.arc(x, y, (0.6 + R() * 1.6) * u, 0, TAU);
    c.fill();
  }
  // depth: the alcove's walls fall into shadow at the edges and under the arch
  const ins = c.createLinearGradient(ax0, 0, ax1, 0);
  ins.addColorStop(0, 'rgba(0,0,0,.45)');
  ins.addColorStop(0.16, 'rgba(0,0,0,0)');
  ins.addColorStop(0.84, 'rgba(0,0,0,0)');
  ins.addColorStop(1, 'rgba(0,0,0,.45)');
  c.fillStyle = ins;
  c.fillRect(0, 0, w, h);
  // the cushion
  cushion(c, cx, sy + disc / 2 - 6 * u, disc * 0.66, 15 * u, 15 * u, k.silk, metal, u);
  c.restore();
  // alcove rim: ink, metal, ink
  alcove(c, ax0, ax1, aTop, aShoulder, aBottom, 10 * u);
  c.strokeStyle = INK;
  c.lineWidth = 8 * u;
  c.stroke();
  c.strokeStyle = metal;
  c.lineWidth = 4.2 * u;
  c.stroke();
  // gilt clouds on the lacquer either side of the arch
  const cc = rarity >= 3 ? 'rgba(243,207,115,.7)' : 'rgba(243,207,115,.38)';
  cloud(c, 62 * u, 26 * u, 0.85 * u, 1, cc, 1.5 * u);
  cloud(c, w - 62 * u, 26 * u, 0.85 * u, -1, cc, 1.5 * u);

  // ---- rarity pill on the keystone
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  tierPill(c, rarity, cx, aTop - 2 * u, u);

  // ---- nameplate with the Chinese name
  const py = aBottom + 34 * u;
  c.font = `${30 * u}px ${F_BRUSH}`;
  const zs = fit(c, f.zh, (s) => `${s}px ${F_BRUSH}`, 30 * u, w * 0.5);
  const pw = Math.min(w - 64 * u, Math.max(118 * u, c.measureText(f.zh).width + 64 * u));
  plaque(c, cx, py, pw, 42 * u, foilGradient(c, w, h, k.metal, w * 0.15), u);
  c.font = `${zs}px ${F_BRUSH}`;
  c.fillStyle = '#5a0a18';
  c.fillText(f.zh, cx, py + 2 * u);

  // ---- translated name and slot, on the lacquer (the foot stays clear for Equip)
  const font = lang === 'th' ? F_SERIF_TH : F_LATIN_SERIF;
  c.font = `700 ${18 * u}px ${font}`;
  const lines = wrap(c, f.name, w - 76 * u, lang === 'th' ? 'th' : 'latin').slice(0, 2);
  c.fillStyle = '#fbeccb';
  lines.forEach((line, i) => c.fillText(line, cx, py + 44 * u + i * 21 * u));
  const ky = py + 44 * u + lines.length * 21 * u - 2 * u;
  c.fillStyle = 'rgba(243,207,115,.75)';
  if (lang === 'th') {
    c.font = `600 ${12 * u}px ${F_SERIF_TH}`;
    c.fillText(f.kind, cx, ky);
  } else {
    c.font = `${11 * u}px ${F_LABEL}`;
    const s = f.kind.toUpperCase().split('').join(String.fromCharCode(8202));
    c.fillText(s, cx, ky);
  }
  // 回纹 band across the foot (the single pull's Equip button sits on it)
  const fy = h - 34 * u;
  c.fillStyle = 'rgba(0,0,0,.3)';
  c.fillRect(0, fy - 11 * u, w, 22 * u);
  c.strokeStyle = INK;
  c.lineWidth = 2 * u;
  c.beginPath();
  c.moveTo(0, fy - 11 * u);
  c.lineTo(w, fy - 11 * u);
  c.moveTo(0, fy + 11 * u);
  c.lineTo(w, fy + 11 * u);
  c.stroke();
  meander(c, 40 * u, w - 40 * u, fy, 12 * u, metal, 1.6 * u);
  c.restore();
  rim(c, w, h, metal, rad, u);
  return cv;
}

/** the card back: the lid of the chest it came out of, with its lock plate and the box's glyph */
export function drawTreasureBack(cv: HTMLCanvasElement, width: number, boxId: string) {
  const { w, h } = cardSize(width);
  const c = sizeCanvas(cv, w, h);
  const t = boxTint(boxId);
  const u = w / 320;
  const rad = 18 * u;
  const metal = foilGradient(c, w, h, [t.metal[0], t.metal[1], t.metal[0], t.metal[3], t.metal[1], t.metal[0], t.metal[2]]);
  const cx = w / 2;
  const cy = h * 0.48;
  c.save();
  rr(c, 0, 0, w, h, rad);
  c.clip();
  lacquer(c, w, h, t.body);

  // inset panel in the panel colour, gilt edge
  const px = 34 * u;
  const pyT = 74 * u;
  const pyB = h - 74 * u;
  const pg = c.createLinearGradient(0, pyT, w * 0.3, pyB);
  pg.addColorStop(0, t.panel[0]);
  pg.addColorStop(1, t.panel[1]);
  rr(c, px, pyT, w - px * 2, pyB - pyT, 8 * u);
  c.fillStyle = pg;
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 3 * u;
  c.stroke();
  rr(c, px + 6 * u, pyT + 6 * u, w - (px + 6 * u) * 2, pyB - pyT - 12 * u, 5 * u);
  c.strokeStyle = metal;
  c.lineWidth = 2 * u;
  c.stroke();
  // clouds in the panel
  const cc = 'rgba(255,224,140,.55)';
  cloud(c, cx - 70 * u, pyT + 52 * u, 1.5 * u, 1, cc, 2 * u);
  cloud(c, cx + 70 * u, pyB - 52 * u, 1.5 * u, -1, cc, 2 * u);
  cloud(c, cx + 72 * u, pyT + 40 * u, 0.9 * u, -1, cc, 1.6 * u);
  cloud(c, cx - 72 * u, pyB - 40 * u, 0.9 * u, 1, cc, 1.6 * u);

  // meander bands top and bottom on dark trim
  for (const y of [42 * u, h - 42 * u]) {
    const tg = c.createLinearGradient(0, y - 13 * u, 0, y + 13 * u);
    tg.addColorStop(0, t.trim[0]);
    tg.addColorStop(1, t.trim[1]);
    c.fillStyle = tg;
    c.fillRect(0, y - 13 * u, w, 26 * u);
    c.strokeStyle = INK;
    c.lineWidth = 2.5 * u;
    c.beginPath();
    c.moveTo(0, y - 13 * u);
    c.lineTo(w, y - 13 * u);
    c.moveTo(0, y + 13 * u);
    c.lineTo(w, y + 13 * u);
    c.stroke();
    meander(c, 30 * u, w - 30 * u, y, 14 * u, t.metal[1], 1.8 * u);
  }

  const lo = 30 * u;
  const lr = 34 * u;
  // the hasp above the plate
  rr(c, cx - 9 * u, pyT - 8 * u, 18 * u, cy - lo - lr - pyT + 22 * u, 7 * u);
  c.fillStyle = metal;
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 2.6 * u;
  c.stroke();
  // 海棠 lock plate: four lobes outlined as one (ink under, metal over), a ring and the glyph
  const lobes = [
    [cx, cy - lo],
    [cx + lo, cy],
    [cx, cy + lo],
    [cx - lo, cy],
  ];
  const glow = c.createRadialGradient(cx, cy, lr, cx, cy, lr * 3.2);
  glow.addColorStop(0, 'rgba(255,230,160,.35)');
  glow.addColorStop(1, 'rgba(255,230,160,0)');
  c.fillStyle = glow;
  c.fillRect(0, 0, w, h);
  c.fillStyle = INK;
  for (const [x, y] of lobes) {
    c.beginPath();
    c.arc(x, y + 3 * u, lr + 3.5 * u, 0, TAU);
    c.fill();
    c.beginPath();
    c.arc(x, y, lr + 3.5 * u, 0, TAU);
    c.fill();
  }
  c.fillStyle = metal;
  for (const [x, y] of lobes) {
    c.beginPath();
    c.arc(x, y, lr, 0, TAU);
    c.fill();
  }
  c.strokeStyle = 'rgba(60,30,5,.35)';
  c.lineWidth = 1.4 * u;
  for (const [x, y] of lobes) {
    c.beginPath();
    c.arc(x, y, lr * 0.72, 0, TAU);
    c.stroke();
  }
  const inner = 40 * u;
  c.beginPath();
  c.arc(cx, cy, inner + 3 * u, 0, TAU);
  c.fillStyle = INK;
  c.fill();
  const ig = c.createRadialGradient(cx - inner * 0.3, cy - inner * 0.35, 0, cx, cy, inner);
  ig.addColorStop(0, t.panel[0]);
  ig.addColorStop(1, t.panel[1]);
  c.beginPath();
  c.arc(cx, cy, inner, 0, TAU);
  c.fillStyle = ig;
  c.fill();
  c.strokeStyle = metal;
  c.lineWidth = 2.5 * u;
  c.beginPath();
  c.arc(cx, cy, inner - 5 * u, 0, TAU);
  c.stroke();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `${inner * 1.15}px ${F_BRUSH}`;
  c.fillStyle = metal;
  c.shadowColor = 'rgba(0,0,0,.45)';
  c.shadowBlur = 5 * u;
  c.fillText(t.glyph, cx, cy + 3 * u);
  c.shadowBlur = 0;
  c.restore();
  rim(c, w, h, metal, rad, u);
  return cv;
}
