/** Trauma-based screen shake (Squirrel Eiserloh style): offset ∝ trauma², decays linearly. */
let el: HTMLElement;
let trauma = 0;
let t = 0;
let zoom = 0;
let reduced = false;

export function mountShake(target: HTMLElement) {
  el = target;
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** amount 0..1 (0.25 = tap, 0.5 = hit, 0.9 = explosion) */
export function shake(amount: number) {
  trauma = Math.min(1, trauma + amount * (reduced ? 0.3 : 1));
}

/** quick zoom punch (0.02–0.06 typical) */
export function punch(amount: number) {
  zoom = Math.max(zoom, amount * (reduced ? 0.3 : 1));
}

const n = (s: number) => Math.sin(s * 1.7) * 0.6 + Math.sin(s * 3.1 + 1.3) * 0.4;

export function updateShake(dt: number) {
  t += dt;
  if (trauma <= 0 && zoom <= 0.0001) {
    if (el.style.transform) el.style.transform = '';
    return;
  }
  const k = trauma * trauma;
  const max = 22;
  const x = max * k * n(t * 40);
  const y = max * k * n(t * 40 + 100);
  const r = 2.2 * k * n(t * 40 + 200);
  const s = 1 + zoom;
  el.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) rotate(${r.toFixed(3)}deg) scale(${s.toFixed(4)})`;
  trauma = Math.max(0, trauma - dt * 1.6);
  zoom = Math.max(0, zoom - dt * zoom * 10 - dt * 0.02);
}
