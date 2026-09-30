/**
 * Hand-rolled Canvas 2D particle system.
 * Motions: ballistic (gravity + drag), inward pull (attractor), curved flight (bezier), orbit.
 * Pooled, additive-blended sparks drawn in a second pass.
 */
import { rand, TAU, clamp } from '../core/util';
import { sprites, type SpriteKey } from './sprites';

export const enum Mode { Ballistic, Pull, Curve, Orbit }
export const enum Kind { Sprite, Ring, Confetti }

export interface Particle {
  on: boolean;
  kind: Kind;
  mode: Mode;
  x: number; y: number; vx: number; vy: number;
  g: number; drag: number;
  life: number; max: number; delay: number;
  size: number; size1: number;
  rot: number; vr: number;
  spin: number; vspin: number; // coin-flip illusion (scaleX = cos(spin))
  spr: HTMLCanvasElement | null;
  add: boolean; stretch: boolean;
  alpha: number;
  color: string;
  // targets
  sx: number; sy: number; cx: number; cy: number; tx: number; ty: number;
  pullAt: number; // seconds of ballistic before pull kicks in
  ang: number; angV: number; rad: number; radV: number; ocx: number; ocy: number;
  onArrive: (() => void) | null;
}

const MAX = 1400;

function blank(): Particle {
  return {
    on: false, kind: Kind.Sprite, mode: Mode.Ballistic,
    x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, life: 0, max: 1, delay: 0,
    size: 20, size1: 20, rot: 0, vr: 0, spin: 0, vspin: 0,
    spr: null, add: false, stretch: false, alpha: 1, color: '#fff',
    sx: 0, sy: 0, cx: 0, cy: 0, tx: 0, ty: 0, pullAt: 0,
    ang: 0, angV: 0, rad: 0, radV: 0, ocx: 0, ocy: 0, onArrive: null,
  };
}

export type Target = { x: number; y: number } | (() => { x: number; y: number });
const resolve = (t: Target) => (typeof t === 'function' ? t() : t);

class Particles {
  private pool: Particle[] = Array.from({ length: MAX }, blank);
  private cv!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private dpr = 1;
  w = 0;
  h = 0;
  /** global multiplier for particle counts (reduced on low-end / reduced motion) */
  density = 1;
  private targets = new WeakMap<Particle, Target>();

  mount(cv: HTMLCanvasElement) {
    this.cv = cv;
    this.ctx = cv.getContext('2d')!;
    this.resize();
    addEventListener('resize', () => this.resize());
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.density = 0.4;
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = innerWidth;
    this.h = innerHeight;
    this.cv.width = this.w * this.dpr;
    this.cv.height = this.h * this.dpr;
  }

  spawn(init: Partial<Particle> & { sprite?: SpriteKey; target?: Target }): Particle | null {
    const p = this.pool.find((q) => !q.on);
    if (!p) return null;
    Object.assign(p, blank(), init);
    p.on = true;
    if (init.sprite) p.spr = sprites()[init.sprite];
    p.sx = p.x;
    p.sy = p.y;
    if (init.target) this.targets.set(p, init.target);
    return p;
  }

  n(count: number) {
    return Math.max(1, Math.round(count * this.density));
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.on) continue;
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.life += dt;
      p.rot += p.vr * dt;
      p.spin += p.vspin * dt;

      switch (p.mode) {
        case Mode.Ballistic: {
          const k = Math.exp(-p.drag * dt);
          p.vx *= k;
          p.vy = p.vy * k + p.g * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          break;
        }
        case Mode.Pull: {
          const tg = resolve(this.targets.get(p)!);
          if (p.life < p.pullAt) {
            const k = Math.exp(-p.drag * dt);
            p.vx *= k;
            p.vy = p.vy * k + p.g * dt;
          } else {
            // accelerating attractor: velocity decays while position is drawn in ever harder
            const pt = p.life - p.pullAt;
            const k = Math.exp(-5 * dt);
            p.vx *= k;
            p.vy *= k;
            const pull = clamp(pt * pt * 40, 0, 1 / dt);
            p.x += (tg.x - p.x) * clamp(pull * dt, 0, 1);
            p.y += (tg.y - p.y) * clamp(pull * dt, 0, 1);
            const d = Math.hypot(tg.x - p.x, tg.y - p.y);
            if (d < 16 || pt > 1.6) {
              p.on = false;
              p.onArrive?.();
              continue;
            }
          }
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          break;
        }
        case Mode.Curve: {
          const tg = resolve(this.targets.get(p)!);
          const t = clamp(p.life / p.max, 0, 1);
          const e = t * t * (3 - 2 * t) * 0.4 + t * t * 0.6; // ease-in with body
          const u = 1 - e;
          p.x = u * u * p.sx + 2 * u * e * p.cx + e * e * tg.x;
          p.y = u * u * p.sy + 2 * u * e * p.cy + e * e * tg.y;
          if (t >= 1) {
            p.on = false;
            p.onArrive?.();
            continue;
          }
          break;
        }
        case Mode.Orbit: {
          p.ang += p.angV * dt;
          p.rad = Math.max(0, p.rad + p.radV * dt);
          p.x = p.ocx + Math.cos(p.ang) * p.rad;
          p.y = p.ocy + Math.sin(p.ang) * p.rad * 0.85;
          break;
        }
      }
      if (p.mode !== Mode.Pull && p.mode !== Mode.Curve && p.life >= p.max) {
        p.on = false;
        p.onArrive?.();
      }
    }
  }

  render() {
    const c = this.ctx;
    const d = this.dpr;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    for (let pass = 0; pass < 2; pass++) {
      c.globalCompositeOperation = pass ? 'lighter' : 'source-over';
      for (const p of this.pool) {
        if (!p.on || p.delay > 0 || p.add !== (pass === 1)) continue;
        const f = p.life / p.max;
        // pop-in overshoot for first 0.12s, shrink toward size1 over life
        const pop = p.life < 0.12 ? 0.4 + (p.life / 0.12) * 0.75 : p.life < 0.2 ? 1.15 - ((p.life - 0.12) / 0.08) * 0.15 : 1;
        const s = (p.size + (p.size1 - p.size) * f) * pop;
        const fade = p.mode === Mode.Pull || p.mode === Mode.Curve ? 1 : f > 0.7 ? 1 - (f - 0.7) / 0.3 : 1;
        c.globalAlpha = clamp(p.alpha * fade, 0, 1);

        if (p.kind === Kind.Ring) {
          const e = 1 - (1 - f) ** 3;
          c.setTransform(d, 0, 0, d, 0, 0);
          c.strokeStyle = p.color;
          c.lineWidth = Math.max(0.5, p.size1 * (1 - f));
          c.beginPath();
          c.arc(p.x, p.y, p.size * e, 0, TAU);
          c.stroke();
          continue;
        }
        if (p.kind === Kind.Confetti) {
          const cs = Math.cos(p.rot);
          const sn = Math.sin(p.rot);
          const flutter = Math.cos(p.spin);
          c.setTransform(cs * d, sn * d, -sn * flutter * d, cs * flutter * d, p.x * d, p.y * d);
          c.fillStyle = p.color;
          c.fillRect(-s / 2, -s / 4, s, s / 2);
          c.lineWidth = 1.5;
          c.strokeStyle = 'rgba(42,26,58,.9)';
          c.strokeRect(-s / 2, -s / 4, s, s / 2);
          continue;
        }
        if (!p.spr) continue;
        let sx = s;
        let sy = s;
        let rot = p.rot;
        if (p.stretch) {
          const sp = Math.hypot(p.vx, p.vy);
          rot = Math.atan2(p.vy, p.vx);
          sx = s * (1 + Math.min(sp / 260, 3));
          sy = s * 0.55;
        }
        if (p.vspin) sx *= Math.max(0.15, Math.abs(Math.cos(p.spin)));
        const cs = Math.cos(rot);
        const sn = Math.sin(rot);
        c.setTransform((cs * sx * d) / 96, (sn * sx * d) / 96, (-sn * sy * d) / 96, (cs * sy * d) / 96, p.x * d, p.y * d);
        c.drawImage(p.spr, -48, -48);
      }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  clear() {
    for (const p of this.pool) p.on = false;
  }

  get active() {
    let n = 0;
    for (const p of this.pool) if (p.on) n++;
    return n;
  }

  // ------------------------------------------------------------ emitters
  burst(
    x: number,
    y: number,
    o: {
      count: number;
      sprite?: SpriteKey | SpriteKey[];
      speed?: [number, number];
      size?: [number, number];
      shrink?: number;
      g?: number;
      drag?: number;
      life?: [number, number];
      add?: boolean;
      stretch?: boolean;
      angle?: number;
      spread?: number;
      spin?: boolean;
      delay?: number;
    },
  ) {
    const n = this.n(o.count);
    for (let i = 0; i < n; i++) {
      const a = (o.angle ?? 0) + (o.spread != null ? rand(-o.spread / 2, o.spread / 2) : rand(0, TAU));
      const sp = rand(...(o.speed ?? [200, 500]));
      const sz = rand(...(o.size ?? [16, 30]));
      const key = Array.isArray(o.sprite) ? o.sprite[i % o.sprite.length] : o.sprite ?? 'spark';
      this.spawn({
        sprite: key,
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        g: o.g ?? 900,
        drag: o.drag ?? 1.5,
        max: rand(...(o.life ?? [0.6, 1.1])),
        size: sz,
        size1: sz * (o.shrink ?? 0.3),
        rot: rand(0, TAU),
        vr: rand(-8, 8),
        add: o.add ?? false,
        stretch: o.stretch ?? false,
        vspin: o.spin ? rand(8, 16) : 0,
        delay: o.delay ?? 0,
      });
    }
  }

  ring(x: number, y: number, radius = 140, color = '#fff', width = 12, life = 0.45) {
    this.spawn({ kind: Kind.Ring, x, y, size: radius, size1: width, max: life, color, alpha: 0.95 });
  }

  /** Coins & yuanbao explode out, hang for a beat, then get sucked into a HUD target. */
  treasure(
    x: number,
    y: number,
    target: Target,
    count: number,
    onEach?: (i: number) => void,
    onFirst?: () => void,
  ) {
    const n = this.n(count);
    let arrived = 0;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(260, 720);
      const isBao = i % 4 === 0;
      const sz = isBao ? rand(38, 50) : rand(26, 36);
      this.spawn({
        sprite: isBao ? 'yuanbao' : 'coin',
        mode: Mode.Pull,
        target,
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 220,
        g: 1400,
        drag: 2.6,
        pullAt: rand(0.38, 0.62),
        max: 3,
        size: sz,
        size1: sz,
        rot: rand(-0.4, 0.4),
        vr: rand(-3, 3),
        vspin: isBao ? 0 : rand(9, 15),
        onArrive: () => {
          if (arrived === 0) onFirst?.();
          onEach?.(arrived++);
        },
      });
    }
  }

  /** Curved flight: things arc toward target along a bezier. */
  arc(x: number, y: number, target: Target, count: number, sprite: SpriteKey, onEach?: () => void) {
    const n = this.n(count);
    const tg = resolve(target);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      this.spawn({
        sprite,
        mode: Mode.Curve,
        target,
        x: x + rand(-20, 20),
        y: y + rand(-20, 20),
        cx: (x + tg.x) / 2 + side * rand(120, 260),
        cy: Math.min(y, tg.y) - rand(80, 240),
        max: rand(0.55, 0.85),
        delay: i * 0.035,
        size: rand(18, 28),
        size1: 14,
        add: sprite.startsWith('spark'),
        vr: rand(-6, 6),
        onArrive: onEach ?? null,
      });
    }
  }

  orbit(cx: number, cy: number, count: number, radius: number, life = 1.2, sprite: SpriteKey = 'sparkGold') {
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      this.spawn({
        sprite,
        mode: Mode.Orbit,
        ocx: cx,
        ocy: cy,
        ang: (i / n) * TAU,
        angV: rand(4, 6),
        rad: radius,
        radV: -radius * 0.3,
        max: life,
        size: rand(14, 26),
        size1: 6,
        add: sprite.startsWith('spark'),
      });
    }
  }

  confetti(count: number, fromTop = true) {
    const colors = ['#ff4757', '#ffc93c', '#3da5ff', '#5be35b', '#ff5fa2', '#9b6bff', '#1fd1c1'];
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      this.spawn({
        kind: Kind.Confetti,
        x: fromTop ? rand(0, this.w) : this.w / 2 + rand(-40, 40),
        y: fromTop ? rand(-80, -10) : this.h * 0.6,
        vx: fromTop ? rand(-60, 60) : rand(-600, 600),
        vy: fromTop ? rand(60, 200) : rand(-1100, -500),
        g: fromTop ? 180 : 900,
        drag: fromTop ? 0.6 : 1.4,
        max: rand(2.2, 3.6),
        size: rand(10, 18),
        size1: rand(10, 18),
        rot: rand(0, TAU),
        vr: rand(-5, 5),
        vspin: rand(6, 14),
        color: colors[i % colors.length],
        delay: fromTop ? rand(0, 0.8) : 0,
      });
    }
  }

  firework(x: number, y: number, color: SpriteKey = 'sparkGold') {
    this.ring(x, y, 110, '#fff6c8', 8, 0.5);
    this.burst(x, y, { count: 36, sprite: color, speed: [300, 620], size: [14, 24], g: 300, drag: 2.2, life: [0.7, 1.2], add: true, stretch: true });
    this.burst(x, y, { count: 10, sprite: ['star', 'starPink'], speed: [150, 380], size: [16, 26], g: 600, life: [0.8, 1.3] });
  }

  rain(sprite: SpriteKey, count: number) {
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const sz = rand(22, 36);
      this.spawn({
        sprite,
        x: rand(0, this.w),
        y: -40,
        vx: rand(-40, 40),
        vy: rand(200, 420),
        g: 500,
        drag: 0.2,
        max: 3,
        size: sz,
        size1: sz,
        vspin: sprite === 'coin' ? rand(6, 12) : 0,
        vr: rand(-2, 2),
        delay: rand(0, 0.3),
      });
    }
  }
}

export const particles = new Particles();
