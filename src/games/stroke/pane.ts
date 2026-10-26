// Writing pane: pointer capture, brush, 米字格, outline, hint and pane FX.
import { h } from '../../core/util';
import type { Glyph } from '../../core/strokes';
import type { Pt } from './matcher';
import { COL, TIER, ease } from './scene';

/** pane-local pixel point + timestamp */
export type RawPt = [number, number, number];

export interface PaneView {
  g: Glyph;
  done: number;
  /** scene time each stroke lit */
  lit: number[];
  /** show the hint for stroke `done` */
  hint: boolean;
  outline: boolean;
}

/** seconds for an accepted stroke to settle from the raw brush path into the glyph's true stroke */
const MORPH = 0.22;

interface PFx {
  k: 'ok' | 'bad' | 'clear';
  t0: number;
  raw?: RawPt[];
  g?: Glyph;
}

export class Pane {
  el: HTMLElement;
  chip: HTMLElement;
  toggle: HTMLButtonElement;
  prompt: HTMLElement;
  /** called with the raw points of a finished stroke */
  onStroke: (raw: RawPt[]) => void = () => {};
  onOutline: (on: boolean) => void = () => {};
  enabled = false;
  /** combo tier (0..3): tints the brush and the settled strokes */
  tier = 0;
  box = { x: 0, y: 0, B: 1, px: 0, py: 0 };
  private cv: HTMLCanvasElement;
  private c: CanvasRenderingContext2D;
  private dpr = 1;
  private drawing: { id: number; pts: RawPt[] } | null = null;
  private fx: PFx[] = [];
  private lastKey = '';
  private force = true;

  constructor(label: string, outlineLabel: string, outline: boolean) {
    this.cv = h('canvas', { class: 'sk-ink' });
    this.c = this.cv.getContext('2d')!;
    this.chip = h('div', { class: 'sk-chip idle' });
    this.toggle = h('button', { class: 'sk-toggle', 'aria-pressed': String(outline) }, outlineLabel);
    this.prompt = h('div', { class: 'sk-prompt' }, label);
    this.el = h('section', { class: 'sk-pane' }, this.cv, h('div', { class: 'sk-pane-top' }, this.chip, this.toggle), this.prompt);
    this.toggle.addEventListener('click', () => {
      const on = this.toggle.getAttribute('aria-pressed') !== 'true';
      this.toggle.setAttribute('aria-pressed', String(on));
      this.force = true;
      this.onOutline(on);
    });
    const el = this.el;
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.drawing || (e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.drawing = { id: e.pointerId, pts: [this.local(e)] };
      this.prompt.style.opacity = '0';
    });
    el.addEventListener('pointermove', (e) => {
      const d = this.drawing;
      if (!d || e.pointerId !== d.id) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) {
        const p = this.local(ev);
        const q = d.pts[d.pts.length - 1];
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1.5) d.pts.push(p);
      }
    });
    const end = (e: PointerEvent) => {
      const d = this.drawing;
      if (!d || e.pointerId !== d.id) return;
      this.drawing = null;
      this.force = true;
      if (this.enabled) this.onStroke(d.pts);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  private local(e: PointerEvent): RawPt {
    const r = this.cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top, performance.now()];
  }

  cancel() {
    this.drawing = null;
    this.force = true;
  }

  layout() {
    const r = this.el.getBoundingClientRect();
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.cv.width = Math.round(r.width * this.dpr);
    this.cv.height = Math.round(r.height * this.dpr);
    const B = Math.max(40, Math.min(r.width - 24, r.height - 52));
    this.box = { x: (r.width - B) / 2, y: 44 + (r.height - 52 - B) / 2, B, px: r.left, py: r.top };
    this.force = true;
  }

  /** raw pane pixels -> 1024 box, y down */
  toBox(raw: RawPt[]): Pt[] {
    const { x, y, B } = this.box;
    return raw.map((p): Pt => [((p[0] - x) / B) * 1024, ((p[1] - y) / B) * 1024]);
  }

  fxOk(raw: RawPt[], t: number) {
    this.fx.push({ k: 'ok', raw, t0: t });
  }
  fxBad(raw: RawPt[], t: number) {
    this.fx.push({ k: 'bad', raw, t0: t });
  }
  fxClear(g: Glyph, t: number) {
    this.fx.push({ k: 'clear', g, t0: t });
  }
  shakePane() {
    this.el.classList.remove('nope');
    void this.el.offsetWidth;
    this.el.classList.add('nope');
  }

  private glyphT() {
    const k = this.box.B / 1024;
    const d = this.dpr;
    this.c.setTransform(d * k, 0, 0, -d * k, d * this.box.x, d * (this.box.y + 900 * k));
  }

  private brush(pts: RawPt[], col: string, w: number, alpha: number, glow: number) {
    const c = this.c;
    if (pts.length < 2) return;
    c.globalAlpha = alpha;
    c.strokeStyle = col;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.shadowColor = col;
    c.shadowBlur = glow * this.dpr;
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      c.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    const z = pts[pts.length - 1];
    c.lineTo(z[0], z[1]);
    c.stroke();
    c.shadowBlur = 0;
    c.globalAlpha = 1;
  }

  /** redraws only when something is moving or the view changed */
  draw(t: number, view: PaneView | null) {
    this.fx = this.fx.filter((e) => t - e.t0 < 1);
    const lastLit = view ? Math.max(-9, ...view.lit) : -9;
    const key = view ? `${view.g.ch}:${view.done}:${view.outline}:${this.tier}` : `${this.tier}`;
    const live = this.drawing || this.fx.length || view?.hint || t - lastLit < 0.8;
    if (!live && key === this.lastKey && !this.force) return;
    this.lastKey = key;
    this.force = false;
    const c = this.c;
    const d = this.dpr;
    const { x, y, B } = this.box;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    c.setTransform(d, 0, 0, d, 0, 0);
    c.strokeStyle = 'rgba(243,234,215,.16)';
    c.lineWidth = 1;
    c.setLineDash([]);
    c.strokeRect(x + 0.5, y + 0.5, B - 1, B - 1);
    c.strokeStyle = 'rgba(255,90,78,.22)';
    c.setLineDash([5, 6]);
    c.beginPath();
    c.moveTo(x + B / 2, y);
    c.lineTo(x + B / 2, y + B);
    c.moveTo(x, y + B / 2);
    c.lineTo(x + B, y + B / 2);
    c.moveTo(x, y);
    c.lineTo(x + B, y + B);
    c.moveTo(x + B, y);
    c.lineTo(x, y + B);
    c.stroke();
    c.setLineDash([]);

    if (view) {
      const g = view.g;
      this.glyphT();
      if (view.outline) {
        c.fillStyle = 'rgba(243,234,215,.075)';
        for (const p of g.paths) c.fill(p);
      }
      const T = TIER[this.tier];
      for (let i = 0; i < view.done; i++) {
        // the raw brush path fades out (see 'ok' below) while the true stroke shape flashes in
        const lt = t - view.lit[i];
        c.globalAlpha = lt < MORPH ? ease(Math.max(0, lt / MORPH)) : 1;
        c.fillStyle = lt < 0.3 ? '#fff6dc' : T.fill;
        c.shadowColor = T.glow;
        c.shadowBlur = (lt < 0.6 ? 34 * (1 - lt / 0.6) : 0) * d;
        c.fill(g.paths[i]);
      }
      c.shadowBlur = 0;
      c.globalAlpha = 1;
      if (view.hint && view.done < g.n) {
        const i = view.done;
        c.fillStyle = `rgba(111,227,193,${0.35 + 0.25 * Math.sin(t * 6)})`;
        c.fill(g.paths[i]);
        const m = g.med[i];
        const k = B / 1024;
        const q = (t * 0.9) % 1;
        const seg: number[] = [];
        let L = 0;
        for (let j = 1; j < m.length; j++) {
          const dd = Math.hypot(m[j][0] - m[j - 1][0], m[j][1] - m[j - 1][1]);
          seg.push(dd);
          L += dd;
        }
        let want = q * L;
        let j = 0;
        while (j < seg.length - 1 && want > seg[j]) {
          want -= seg[j];
          j++;
        }
        const u = seg[j] ? want / seg[j] : 0;
        const px = m[j][0] + (m[j + 1][0] - m[j][0]) * u;
        const py = m[j][1] + (m[j + 1][1] - m[j][1]) * u;
        c.setTransform(d, 0, 0, d, 0, 0);
        c.fillStyle = COL.jade;
        c.shadowColor = COL.jade;
        c.shadowBlur = 12 * d;
        c.beginPath();
        c.arc(x + px * k, y + py * k, 6, 0, 7);
        c.fill();
        c.shadowBlur = 0;
        c.fillStyle = 'rgba(111,227,193,.9)';
        c.beginPath();
        c.arc(x + m[0][0] * k, y + m[0][1] * k, 3, 0, 7);
        c.fill();
      }
    }
    c.setTransform(d, 0, 0, d, 0, 0);
    for (const e of this.fx) {
      const tt = t - e.t0;
      if (e.k === 'ok' && tt < MORPH) this.brush(e.raw!, TIER[this.tier].fill, B * 0.05 * (1 - 0.35 * (tt / MORPH)), 1 - ease(tt / MORPH), 14);
      if (e.k === 'bad' && tt < 0.6) {
        const jit = tt < 0.25 ? Math.sin(tt * 80) * 4 : 0;
        this.brush(e.raw!.map((p): RawPt => [p[0] + jit, p[1] + (tt > 0.25 ? (tt - 0.25) * 60 : 0), p[2]]), COL.red, B * 0.05, 1 - tt / 0.6, 10);
      }
      if (e.k === 'clear' && tt < 0.7) {
        this.glyphT();
        c.globalAlpha = 1 - ease(tt / 0.7);
        c.fillStyle = COL.goldHi;
        c.shadowColor = COL.gold;
        c.shadowBlur = 30 * d;
        for (const p of e.g!.paths) c.fill(p);
        c.shadowBlur = 0;
        c.globalAlpha = 1;
        c.setTransform(d, 0, 0, d, 0, 0);
      }
    }
    if (this.drawing) this.brush(this.drawing.pts, this.tier ? TIER[this.tier].fill : COL.ivory, B * 0.05, 1, 10);
  }
}
