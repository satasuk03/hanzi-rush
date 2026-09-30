/** Rarity-scaled celebration FX shared by the vault ceremony and the collection. */
import gsap from 'gsap';
import { rand } from '../../core/util';
import type { SpriteKey } from '../../engine/sprites';
import { particles } from '../../engine/particles';
import { shake, punch } from '../../engine/shake';

export const SPARK: SpriteKey[] = ['sparkWhite', 'sparkBlue', 'sparkPurple', 'sparkGold', 'sparkPink'];
const RAINBOW: SpriteKey[] = ['sparkPink', 'sparkGold', 'sparkCyan', 'sparkBlue', 'sparkPurple'];

export function flash(color: string, strength: number, dur = 0.4) {
  const f = document.getElementById('flash')!;
  f.style.background = color;
  gsap.fromTo(f, { opacity: strength }, { opacity: 0, duration: dur, ease: 'power2.out', overwrite: true });
}

/** the burst when a card lands face up */
export function revealFx(r: number, x: number, y: number, w: number, hgt: number, color: string) {
  const sp = SPARK[r];
  particles.ring(x, y, w * (0.7 + r * 0.25), '#fff', 5, 0.5);
  if (r >= 1) particles.ring(x, y, w * (1 + r * 0.3), color, 3, 0.7);
  particles.burst(x, y, { count: 16 + r * 14, sprite: sp, speed: [260, 700 + r * 120], size: [14, 26], g: 260, drag: 2.2, life: [0.45, 0.9], add: true, stretch: true });
  // ink flicks off the card edges
  for (let i = 0; i < 6 + r * 2; i++) {
    const side = i % 2 ? 1 : -1;
    particles.burst(x + side * w * 0.5, y + rand(-hgt * 0.4, hgt * 0.4), { count: 1, sprite: 'ink', speed: [260, 560], size: [10, 22], g: 1200, drag: 1.2, life: [0.6, 1], angle: side > 0 ? 0 : Math.PI, spread: 1.2 });
  }
  if (r >= 2) {
    particles.burst(x, y, { count: 10 + r * 4, sprite: ['star', 'starPink'], speed: [220, 560], size: [16, 28], g: 900, life: [0.7, 1.1] });
    particles.burst(x, y, { count: 12, sprite: 'goldLeaf', speed: [120, 420], size: [10, 20], g: 180, drag: 1.4, life: [1.2, 2], spin: true });
    shake(0.25 + (r - 2) * 0.15);
    flash(color, 0.35);
  }
  if (r >= 3) {
    for (let i = 0; i < (r === 4 ? 6 : 3); i++) {
      gsap.delayedCall(0.12 + i * 0.16, () => {
        const fx = rand(innerWidth * 0.1, innerWidth * 0.9);
        const fy = rand(innerHeight * 0.08, innerHeight * 0.34);
        const spr = r === 4 ? RAINBOW[i % RAINBOW.length] : 'sparkGold';
        // firework without the cartoon ring: long streaks + a soft core
        particles.burst(fx, fy, { count: 34, sprite: spr, speed: [280, 600], size: [12, 22], g: 260, drag: 2.1, life: [0.7, 1.2], add: true, stretch: true });
        particles.burst(fx, fy, { count: 3, sprite: 'glow', speed: [0, 30], size: [90, 140], g: 0, life: [0.3, 0.45], add: true, shrink: 1.2 });
      });
    }
    particles.rain('coin', r === 4 ? 26 : 16);
    if (r === 4) particles.rain('yuanbao', 10);
    punch(0.03 + (r - 3) * 0.03);
    flash('#fff6d6', 0.7, 0.6);
  }
  if (r >= 4) {
    particles.confetti(160);
    particles.orbit(x, y, 24, w * 0.75, 1.4, 'sparkPink');
    shake(0.9);
  }
}
