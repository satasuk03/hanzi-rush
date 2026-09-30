/** Pre-rendered cartoon sprites (thick ink outlines) used by the particle system. */
import { TAU } from '../core/util';

export const INK = '#2a1a3a';
const S = 96; // sprite resolution (drawn scaled down → crisp on retina)

function make(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  c.translate(w / 2, h / 2);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  draw(c);
  return cv;
}

function coin(c: CanvasRenderingContext2D) {
  const r = S * 0.42;
  c.fillStyle = '#ffc93c';
  c.strokeStyle = INK;
  c.lineWidth = 7;
  c.beginPath();
  c.arc(0, 0, r, 0, TAU);
  c.fill();
  c.stroke();
  c.strokeStyle = '#e8930c';
  c.lineWidth = 5;
  c.beginPath();
  c.arc(0, 0, r * 0.7, 0, TAU);
  c.stroke();
  // square hole (古钱)
  const q = r * 0.3;
  c.globalCompositeOperation = 'destination-out';
  c.fillRect(-q, -q, q * 2, q * 2);
  c.globalCompositeOperation = 'source-over';
  c.strokeStyle = INK;
  c.lineWidth = 6;
  c.strokeRect(-q, -q, q * 2, q * 2);
  // shine
  c.strokeStyle = 'rgba(255,255,255,.85)';
  c.lineWidth = 5;
  c.beginPath();
  c.arc(0, 0, r * 0.84, Math.PI * 1.1, Math.PI * 1.45);
  c.stroke();
}

function yuanbao(c: CanvasRenderingContext2D) {
  const w = S * 0.9;
  const hgt = S * 0.5;
  c.translate(0, S * 0.06);
  c.strokeStyle = INK;
  c.lineWidth = 6;
  // dome
  c.fillStyle = '#ffd95a';
  c.beginPath();
  c.ellipse(0, -hgt * 0.28, w * 0.24, hgt * 0.5, 0, Math.PI, TAU);
  c.fill();
  c.stroke();
  // boat body with curled tips
  c.fillStyle = '#ffb81f';
  c.beginPath();
  c.moveTo(-w / 2, -hgt * 0.45);
  c.quadraticCurveTo(-w * 0.34, -hgt * 0.02, -w * 0.2, -hgt * 0.12);
  c.lineTo(w * 0.2, -hgt * 0.12);
  c.quadraticCurveTo(w * 0.34, -hgt * 0.02, w / 2, -hgt * 0.45);
  c.quadraticCurveTo(w * 0.42, hgt * 0.5, 0, hgt * 0.5);
  c.quadraticCurveTo(-w * 0.42, hgt * 0.5, -w / 2, -hgt * 0.45);
  c.closePath();
  c.fill();
  c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.8)';
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(-w * 0.28, hgt * 0.12);
  c.quadraticCurveTo(-w * 0.16, hgt * 0.32, 0, hgt * 0.34);
  c.stroke();
  c.beginPath();
  c.ellipse(-w * 0.08, -hgt * 0.5, w * 0.05, hgt * 0.12, -0.4, 0, TAU);
  c.fillStyle = 'rgba(255,255,255,.85)';
  c.fill();
}

function star(c: CanvasRenderingContext2D, fill = '#ffe14d') {
  const R = S * 0.42;
  const r = R * 0.48;
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r : R;
    c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath();
  c.fillStyle = fill;
  c.strokeStyle = INK;
  c.lineWidth = 7;
  c.fill();
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,.7)';
  c.beginPath();
  c.ellipse(-R * 0.18, -R * 0.2, R * 0.12, R * 0.07, -0.6, 0, TAU);
  c.fill();
}

function glow(c: CanvasRenderingContext2D, color: string) {
  const g = c.createRadialGradient(0, 0, 0, 0, 0, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(-S / 2, -S / 2, S, S);
}

function heartShard(c: CanvasRenderingContext2D) {
  c.fillStyle = '#ff4757';
  c.strokeStyle = INK;
  c.lineWidth = 6;
  c.beginPath();
  c.moveTo(-S * 0.3, -S * 0.25);
  c.lineTo(S * 0.32, -S * 0.1);
  c.lineTo(-S * 0.05, S * 0.32);
  c.closePath();
  c.fill();
  c.stroke();
}

function puff(c: CanvasRenderingContext2D) {
  c.fillStyle = '#ffffff';
  c.strokeStyle = INK;
  c.lineWidth = 6;
  c.beginPath();
  c.arc(0, 0, S * 0.36, 0, TAU);
  c.fill();
  c.stroke();
}

function paper(c: CanvasRenderingContext2D) {
  // card shard: cream with ink border
  c.fillStyle = '#fff4dc';
  c.strokeStyle = INK;
  c.lineWidth = 6;
  c.beginPath();
  c.moveTo(-S * 0.36, -S * 0.2);
  c.lineTo(S * 0.3, -S * 0.34);
  c.lineTo(S * 0.36, S * 0.22);
  c.lineTo(-S * 0.2, S * 0.3);
  c.closePath();
  c.fill();
  c.stroke();
}

function petal(c: CanvasRenderingContext2D) {
  c.fillStyle = '#ff8fb8';
  c.strokeStyle = INK;
  c.lineWidth = 5;
  c.beginPath();
  c.ellipse(0, 0, S * 0.3, S * 0.18, 0, 0, TAU);
  c.fill();
  c.stroke();
}

/** ink splatter: a main drop with satellite droplets */
function ink(c: CanvasRenderingContext2D) {
  c.fillStyle = '#17111d';
  c.beginPath();
  c.arc(0, 0, S * 0.2, 0, TAU);
  c.fill();
  const drops = [[0.3, -0.12, 0.07], [-0.26, 0.2, 0.06], [0.1, 0.32, 0.045], [-0.3, -0.24, 0.04], [0.36, 0.22, 0.03]];
  for (const [x, y, r] of drops) {
    c.beginPath();
    c.arc(x * S, y * S, r * S, 0, TAU);
    c.fill();
  }
  c.fillStyle = 'rgba(255,255,255,.18)';
  c.beginPath();
  c.ellipse(-S * 0.06, -S * 0.07, S * 0.06, S * 0.035, -0.6, 0, TAU);
  c.fill();
}

/** gold leaf flake, lit on one side */
function goldLeaf(c: CanvasRenderingContext2D) {
  const g = c.createLinearGradient(-S * 0.3, -S * 0.3, S * 0.3, S * 0.3);
  g.addColorStop(0, '#fff6c9');
  g.addColorStop(0.45, '#f4c64f');
  g.addColorStop(1, '#a8701a');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(-S * 0.34, -S * 0.12);
  c.lineTo(-S * 0.05, -S * 0.34);
  c.lineTo(S * 0.3, -S * 0.2);
  c.lineTo(S * 0.36, S * 0.14);
  c.lineTo(S * 0.04, S * 0.34);
  c.lineTo(-S * 0.28, S * 0.2);
  c.closePath();
  c.fill();
}

export type SpriteKey =
  | 'coin' | 'yuanbao' | 'star' | 'starPink' | 'spark' | 'sparkRed' | 'sparkGold' | 'sparkCyan'
  | 'sparkBlue' | 'sparkPurple' | 'sparkWhite' | 'sparkPink'
  | 'glow' | 'heart' | 'puff' | 'paper' | 'petal' | 'ink' | 'goldLeaf';

let cache: Record<SpriteKey, HTMLCanvasElement> | null = null;

export function sprites() {
  if (!cache) {
    cache = {
      coin: make(S, S, coin),
      yuanbao: make(S, S, yuanbao),
      star: make(S, S, (c) => star(c)),
      starPink: make(S, S, (c) => star(c, '#ff7ab8')),
      spark: make(S, S, (c) => glow(c, 'rgba(255,240,160,.9)')),
      sparkRed: make(S, S, (c) => glow(c, 'rgba(255,90,90,.9)')),
      sparkGold: make(S, S, (c) => glow(c, 'rgba(255,190,40,.9)')),
      sparkCyan: make(S, S, (c) => glow(c, 'rgba(90,230,255,.9)')),
      sparkBlue: make(S, S, (c) => glow(c, 'rgba(70,140,255,.95)')),
      sparkPurple: make(S, S, (c) => glow(c, 'rgba(180,90,255,.95)')),
      sparkWhite: make(S, S, (c) => glow(c, 'rgba(235,230,255,.9)')),
      sparkPink: make(S, S, (c) => glow(c, 'rgba(255,90,150,.95)')),
      glow: make(S, S, (c) => glow(c, 'rgba(255,220,120,.5)')),
      heart: make(S, S, heartShard),
      puff: make(S, S, puff),
      paper: make(S, S, paper),
      petal: make(S, S, petal),
      ink: make(S, S, ink),
      goldLeaf: make(S, S, goldLeaf),
    };
  }
  return cache;
}
