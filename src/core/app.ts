/** Screen router with a juicy iris transition. Screens are plain objects owning a root element. */
import gsap from 'gsap';
import { background, type ThemeName } from '../engine/background';
import { audio } from '../engine/audio';
import { particles } from '../engine/particles';
import { stopAllLoops } from '../engine/juice';

export interface Screen {
  el: HTMLElement;
  theme: ThemeName;
  /** called after the element is in the DOM and the iris opens */
  enter?(): void;
  /** called before removal */
  leave?(): void;
  update?(dt: number): void;
  onKey?(e: KeyboardEvent): void;
  onHidden?(): void;
  /** root screen: hardware back exits the app here */
  home?: boolean;
}

class App {
  root!: HTMLElement;
  private iris!: HTMLElement;
  current: Screen | null = null;
  private busy = false;

  mount(root: HTMLElement, iris: HTMLElement) {
    this.root = root;
    this.iris = iris;
    addEventListener('keydown', (e) => this.current?.onKey?.(e));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.current?.onHidden?.();
    });
  }

  /** First screen: no iris, just show. */
  show(s: Screen) {
    this.current = s;
    this.root.append(s.el);
    background.setTheme(s.theme, 0.01);
    s.enter?.();
  }

  async go(make: () => Screen, from?: { x: number; y: number }) {
    if (this.busy) return;
    this.busy = true;
    const x = from?.x ?? innerWidth / 2;
    const y = from?.y ?? innerHeight / 2;
    const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 20;
    audio.whoosh();
    const medal = this.iris.firstElementChild as HTMLElement;
    gsap.set(this.iris, { display: 'block', clipPath: `circle(0px at ${x}px ${y}px)` });
    gsap.set(medal, { scale: 0, rotation: -180 });
    await gsap.to(this.iris, { clipPath: `circle(${R}px at ${x}px ${y}px)`, duration: 0.38, ease: 'power3.in' });
    gsap.to(medal, { scale: 1, rotation: 0, duration: 0.35, ease: 'back.out(2)' });

    // swap screens while covered
    this.current?.leave?.();
    stopAllLoops();
    this.current?.el.remove();
    particles.clear();
    const next = make();
    this.current = next;
    this.root.append(next.el);
    background.setTheme(next.theme, 0.01);
    await new Promise((r) => setTimeout(r, 160));

    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    const R2 = Math.hypot(cx, cy) + 20;
    gsap.to(medal, { scale: 0, rotation: 180, duration: 0.3, ease: 'back.in(2)' });
    gsap.set(this.iris, { clipPath: `circle(${R2}px at ${cx}px ${cy}px)` });
    audio.swoosh();
    next.enter?.();
    await gsap.to(this.iris, { clipPath: `circle(0px at ${cx}px ${cy}px)`, duration: 0.5, ease: 'power3.inOut', delay: 0.08 });
    gsap.set(this.iris, { display: 'none' });
    this.busy = false;
  }

  /**
   * Hardware back: every screen already maps Escape to back/pause/skip. False on the home screen. Dispatched through
   * the DOM (reaching onKey via the listener in mount), so an open modal can catch it first (src/ui/playerCard.ts).
   */
  back() {
    const s = this.current;
    if (!s || s.home) return false;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  }

  update(dt: number) {
    this.current?.update?.(dt);
  }
}

export const app = new App();
