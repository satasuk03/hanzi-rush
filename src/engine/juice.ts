/** GSAP helpers: squash-stretch pops, elastic entrances, managed loop tweens. */
import gsap from 'gsap';

gsap.defaults({ overwrite: 'auto' });

/** squash → stretch → elastic settle */
export function pop(el: Element, power = 1) {
  return gsap
    .timeline()
    .to(el, { scaleX: 1 + 0.28 * power, scaleY: 1 - 0.22 * power, duration: 0.07, ease: 'power2.out' })
    .to(el, { scaleX: 1 - 0.12 * power, scaleY: 1 + 0.16 * power, duration: 0.09, ease: 'power2.out' })
    .to(el, { scaleX: 1, scaleY: 1, duration: 0.6, ease: 'elastic.out(1.1, 0.35)' });
}

/** drop in from above with squash on landing */
export function dropIn(el: Element, delay = 0, from = -120) {
  return gsap
    .timeline({ delay })
    .fromTo(el, { y: from, scaleX: 0.7, scaleY: 1.3, opacity: 0 }, { y: 0, opacity: 1, scaleY: 1.3, duration: 0.28, ease: 'power3.in' })
    .to(el, { scaleX: 1.3, scaleY: 0.72, duration: 0.07, ease: 'power2.out' })
    .to(el, { scaleX: 1, scaleY: 1, duration: 0.7, ease: 'elastic.out(1.2, 0.3)' });
}

/** scale up from 0 with overshoot and wobble */
export function popIn(el: Element | Element[], delay = 0, stagger = 0.06) {
  return gsap.fromTo(
    el,
    { scale: 0, rotation: () => gsap.utils.random(-12, 12) },
    { scale: 1, rotation: 0, duration: 0.7, delay, stagger, ease: 'elastic.out(1.1, 0.45)' },
  );
}

/** press feedback: squash on down, elastic release on up */
export function pressable(el: HTMLElement, onTap?: (e: PointerEvent) => void) {
  let down = false;
  el.addEventListener('pointerdown', () => {
    down = true;
    gsap.to(el, { scaleX: 1.08, scaleY: 0.88, y: 4, duration: 0.08, ease: 'power2.out' });
  });
  const release = (fire: boolean, e?: PointerEvent) => {
    if (!down) return;
    down = false;
    gsap.to(el, { scaleX: 1, scaleY: 1, y: 0, duration: 0.55, ease: 'elastic.out(1.2, 0.35)' });
    if (fire && onTap && e) onTap(e);
  };
  el.addEventListener('pointerup', (e) => release(true, e));
  el.addEventListener('pointerleave', () => release(false));
  el.addEventListener('pointercancel', () => release(false));
  return el;
}

/** horizontal "no!" shake */
export function nope(el: Element) {
  return gsap
    .timeline()
    .to(el, { x: -16, rotation: -3, duration: 0.05 })
    .to(el, { x: 14, rotation: 3, duration: 0.06 })
    .to(el, { x: -10, rotation: -2, duration: 0.06 })
    .to(el, { x: 6, rotation: 1, duration: 0.06 })
    .to(el, { x: 0, rotation: 0, duration: 0.4, ease: 'elastic.out(1, 0.3)' });
}

/**
 * Looping tweens (breathing, jitter, flame flicker) registered by key.
 * Stopping kills the tween AND resets the animated props to rest immediately,
 * so a loop never lags a frame behind a state change and snaps back later.
 */
const loops = new Map<string, { tw: gsap.core.Animation; el: Element; rest: gsap.TweenVars }>();

export function loop(key: string, el: Element, make: () => gsap.core.Animation, rest: gsap.TweenVars) {
  stopLoop(key);
  loops.set(key, { tw: make(), el, rest });
}

export function stopLoop(key: string) {
  const l = loops.get(key);
  if (!l) return;
  l.tw.kill();
  gsap.killTweensOf(l.el, Object.keys(l.rest).join(','));
  gsap.set(l.el, l.rest);
  loops.delete(key);
}

export function stopAllLoops(prefix = '') {
  for (const k of [...loops.keys()]) if (k.startsWith(prefix)) stopLoop(k);
}

export const breathe = (el: Element, amt = 0.04, dur = 1.1) =>
  gsap.to(el, { scaleX: 1 + amt, scaleY: 1 - amt, duration: dur, yoyo: true, repeat: -1, ease: 'sine.inOut' });

export const bob = (el: Element, amt = 8, dur = 1.4) =>
  gsap.to(el, { y: -amt, duration: dur, yoyo: true, repeat: -1, ease: 'sine.inOut' });

/** Count a number up in an element with bounce on finish. */
export function countTo(el: HTMLElement, from: number, to: number, dur: number, fmt: (n: number) => string, onStep?: () => void) {
  const o = { v: from };
  let last = Math.floor(from);
  return gsap.to(o, {
    v: to,
    duration: dur,
    ease: 'power2.out',
    onUpdate() {
      el.textContent = fmt(o.v);
      const f = Math.floor(o.v / Math.max(1, (to - from) / 12));
      if (f !== last) {
        last = f;
        onStep?.();
      }
    },
  });
}
