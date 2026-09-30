/**
 * Card faces are drawn to canvases. The same canvas is shown in the DOM *and* uploaded
 * as a WebGL texture for flips, so the 3D card and the resting card match pixel-for-pixel.
 */
import type { Word } from '../../core/data';
import type { Lang } from '../../core/i18n';
import { INK } from '../../engine/sprites';
import { TAU } from '../../core/util';

export const F_HANZI = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
export const F_LATIN = 'Nunito, "Mitr", system-ui, sans-serif';
export const F_THAI = 'Mitr, Nunito, system-ui, sans-serif';
export const F_PINYIN = '"Noto Sans SC", "Noto Sans", sans-serif';
export const F_DISPLAY = '"Lilita One", Nunito, system-ui, sans-serif';

export function sizeCanvas(cv: HTMLCanvasElement, w: number, h: number) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  const c = cv.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  return c;
}

const R = 30;
const BORDER = 5;

function body(c: CanvasRenderingContext2D, w: number, h: number, fill: string, shade: string) {
  const i = BORDER / 2;
  // drop "thickness" slab
  c.fillStyle = INK;
  c.beginPath();
  c.roundRect(i, i + 6, w - BORDER, h - BORDER - 6, R);
  c.fill();
  c.fillStyle = fill;
  c.strokeStyle = INK;
  c.lineWidth = BORDER;
  c.beginPath();
  c.roundRect(i, i, w - BORDER, h - BORDER - 8, R);
  c.fill();
  c.stroke();
  // bottom shade band
  c.save();
  c.beginPath();
  c.roundRect(i + 3, i + 3, w - BORDER - 6, h - BORDER - 14, R - 3);
  c.clip();
  c.fillStyle = shade;
  c.fillRect(0, h - 34, w, 30);
  // top gloss
  c.fillStyle = 'rgba(255,255,255,.55)';
  c.beginPath();
  c.roundRect(22, 12, w - 44, 12, 6);
  c.fill();
  c.restore();
}

function cornerKnots(c: CanvasRenderingContext2D, w: number, h: number, color: string) {
  c.strokeStyle = color;
  c.lineWidth = 3;
  const m = 18;
  const L = 22;
  const hh = h - 8;
  for (const [x, y, sx, sy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, hh - m, 1, -1], [w - m, hh - m, -1, -1]] as const) {
    c.beginPath();
    c.moveTo(x, y + L * sy);
    c.lineTo(x, y);
    c.lineTo(x + L * sx, y);
    c.moveTo(x + 7 * sx, y + (L - 8) * sy);
    c.lineTo(x + 7 * sx, y + 7 * sy);
    c.lineTo(x + (L - 8) * sx, y + 7 * sy);
    c.stroke();
  }
}

function fitFont(c: CanvasRenderingContext2D, text: string, weight: number, family: string, max: number, maxW: number) {
  let s = max;
  c.font = `${weight} ${s}px ${family}`;
  const m = c.measureText(text).width;
  if (m > maxW) s = Math.floor((s * maxW) / m);
  c.font = `${weight} ${s}px ${family}`;
  return s;
}

/** Big text with a thick ink outline + offset shadow — the cartoon title look. */
export function outlined(c: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, stroke = INK, lw = 8, shadow = true) {
  c.lineWidth = lw;
  c.strokeStyle = stroke;
  if (shadow) {
    c.fillStyle = stroke;
    c.strokeText(text, x, y + lw * 0.5);
    c.fillText(text, x, y + lw * 0.5);
  }
  c.strokeText(text, x, y);
  c.fillStyle = fill;
  c.fillText(text, x, y);
}

export function drawFront(cv: HTMLCanvasElement, w: number, h: number, word: Word, showPinyin: boolean) {
  const c = sizeCanvas(cv, w, h);
  body(c, w, h, '#fff7e6', '#f5e3bf');
  cornerKnots(c, w, h, '#f0b54a');
  const hh = h - 8;
  const len = [...word.h].length;
  const hanziMax = Math.min(hh * (showPinyin ? 0.46 : 0.56), 150);
  const hy = showPinyin ? hh * 0.6 : hh * 0.52;
  if (showPinyin) {
    fitFont(c, word.p, 700, F_PINYIN, Math.min(hh * 0.14, 34), w * 0.8);
    c.fillStyle = '#ff4757';
    c.fillText(word.p, w / 2, hh * 0.24);
  }
  fitFont(c, word.h, 900, F_HANZI, hanziMax, w * (len > 3 ? 0.88 : 0.8));
  c.fillStyle = 'rgba(42,26,58,.14)';
  c.fillText(word.h, w / 2 + 3, hy + 5);
  c.fillStyle = INK;
  c.fillText(word.h, w / 2, hy);
}

export function drawPatternBack(cv: HTMLCanvasElement, w: number, h: number) {
  const c = sizeCanvas(cv, w, h);
  body(c, w, h, '#ff3b4f', '#d92a40');
  const hh = h - 8;
  // coin lattice
  c.save();
  c.beginPath();
  c.roundRect(14, 14, w - 28, hh - 28, R - 10);
  c.clip();
  c.strokeStyle = 'rgba(255,210,90,.35)';
  c.lineWidth = 3;
  for (let y = 0; y < hh + 40; y += 36)
    for (let x = (y / 36) % 2 ? 18 : 0; x < w + 40; x += 36) {
      c.beginPath();
      c.arc(x, y, 12, 0, TAU);
      c.stroke();
      c.strokeRect(x - 4, y - 4, 8, 8);
    }
  c.restore();
  c.strokeStyle = '#ffc93c';
  c.lineWidth = 4;
  c.beginPath();
  c.roundRect(14, 14, w - 28, hh - 28, R - 10);
  c.stroke();
  // medallion
  const r = Math.min(hh * 0.3, 64);
  c.fillStyle = '#ffc93c';
  c.strokeStyle = INK;
  c.lineWidth = 6;
  c.beginPath();
  c.arc(w / 2, hh / 2, r, 0, TAU);
  c.fill();
  c.stroke();
  c.strokeStyle = '#e8930c';
  c.lineWidth = 4;
  c.beginPath();
  c.arc(w / 2, hh / 2, r * 0.78, 0, TAU);
  c.stroke();
  c.font = `900 ${r * 1.05}px ${F_HANZI}`;
  c.fillStyle = '#ff3b4f';
  c.fillText('汉', w / 2, hh / 2 + r * 0.04);
}

/** Thai has no spaces between words → wrap with Intl.Segmenter; CJK wraps per char. */
export function wrap(c: CanvasRenderingContext2D, text: string, maxW: number, lang: 'zh' | 'th' | 'latin'): string[] {
  let units: string[];
  if (lang === 'zh') units = [...text];
  else if (lang === 'th' && 'Segmenter' in Intl) {
    units = [...new (Intl as any).Segmenter('th', { granularity: 'word' }).segment(text)].map((s: any) => s.segment);
  } else units = text.split(/(\s+)/);
  const lines: string[] = [];
  let cur = '';
  for (const u of units) {
    const next = cur + u;
    if (c.measureText(next).width > maxW && cur.trim()) {
      lines.push(cur.trim());
      cur = u.trimStart();
    } else cur = next;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

export function drawAnswerBack(cv: HTMLCanvasElement, w: number, h: number, word: Word, lang: Lang, label: string) {
  const c = sizeCanvas(cv, w, h);
  body(c, w, h, '#fff7e6', '#f5e3bf');
  const hh = h - 8;
  const padX = 22;
  const maxW = w - padX * 2;

  // ribbon
  c.font = `400 17px ${F_DISPLAY}`;
  const rw = c.measureText(label).width + 36;
  c.fillStyle = '#5be35b';
  c.strokeStyle = INK;
  c.lineWidth = 4;
  c.beginPath();
  c.roundRect(w / 2 - rw / 2, -2, rw, 30, [0, 0, 14, 14]);
  c.fill();
  c.stroke();
  outlined(c, label, w / 2, 14, '#fff', INK, 4, false);

  // layout pass with shrink-to-fit
  const meaning = lang === 'th' ? word.th : word.en;
  const other = lang === 'th' ? word.en : word.th;
  const trans = lang === 'th' ? word.ex.th : word.ex.en;
  const fMean = lang === 'th' ? F_THAI : F_LATIN;

  for (let k = 1; k > 0.5; k -= 0.06) {
    const rows: { font: string; color: string; lines: string[]; lh: number }[] = [];
    const add = (text: string, font: string, size: number, color: string, kind: 'zh' | 'th' | 'latin') => {
      c.font = `${font.replace('{s}', String(Math.round(size * k)))}`;
      rows.push({ font: c.font, color, lines: wrap(c, text, maxW, kind), lh: size * k * 1.25 });
    };
    add(`${word.h}  ${word.p}`, `900 {s}px ${F_PINYIN}`, 30, INK, 'latin');
    add(meaning, `700 {s}px ${fMean}`, 30, '#e8344e', lang === 'th' ? 'th' : 'latin');
    add(other, `700 {s}px ${lang === 'th' ? F_LATIN : F_THAI}`, 16, '#8a7a90', lang === 'th' ? 'latin' : 'th');
    add(word.ex.zh, `700 {s}px ${F_HANZI}`, 21, INK, 'zh');
    add(word.ex.py, `700 {s}px ${F_PINYIN}`, 14, '#ff7a1f', 'latin');
    add(trans, `600 {s}px ${lang === 'th' ? F_THAI : F_LATIN}`, 16, '#4b3a5a', lang === 'th' ? 'th' : 'latin');
    const gap = 10 * k;
    const total = rows.reduce((a, r) => a + r.lines.length * r.lh, 0) + gap;
    if (total <= hh - 50 || k <= 0.56) {
      let y = 34 + (hh - 40 - total) / 2;
      rows.forEach((r, i) => {
        if (i === 3) {
          // divider before the example
          c.strokeStyle = '#f0b54a';
          c.lineWidth = 3;
          c.setLineDash([2, 7]);
          c.beginPath();
          c.moveTo(padX + 20, y + gap / 2);
          c.lineTo(w - padX - 20, y + gap / 2);
          c.stroke();
          c.setLineDash([]);
          y += gap;
        }
        c.font = r.font;
        c.fillStyle = r.color;
        for (const line of r.lines) {
          c.fillText(line, w / 2, y + r.lh / 2);
          y += r.lh;
        }
      });
      break;
    }
  }
}
