/** "Deng Deng" 灯灯 — a chubby lantern buddy. Pure SVG so it scales crisply. */
import gsap from 'gsap';
import { h } from '../core/util';

export type Mood = 'happy' | 'wow' | 'sad' | 'idle';

const SVG = `
<svg viewBox="0 0 200 230" class="mascot-svg" aria-hidden="true">
  <g class="m-tassel"><path d="M92 196h16l5 30H87z" fill="#ffc93c" stroke="#2a1a3a" stroke-width="6" stroke-linejoin="round"/></g>
  <g class="m-body">
    <line x1="100" y1="0" x2="100" y2="26" stroke="#2a1a3a" stroke-width="6"/>
    <rect x="62" y="22" width="76" height="22" rx="8" fill="#ffc93c" stroke="#2a1a3a" stroke-width="6"/>
    <rect x="62" y="178" width="76" height="22" rx="8" fill="#ffc93c" stroke="#2a1a3a" stroke-width="6"/>
    <ellipse cx="100" cy="112" rx="86" ry="74" fill="#ff3b4f" stroke="#2a1a3a" stroke-width="7"/>
    <path d="M60 46c-26 36-26 96 0 132M140 46c26 36 26 96 0 132" fill="none" stroke="#c81e36" stroke-width="5"/>
    <ellipse cx="52" cy="80" rx="10" ry="20" fill="#fff" opacity=".55" transform="rotate(25 52 80)"/>
    <g class="m-face">
      <ellipse class="m-blush" cx="56" cy="128" rx="13" ry="8" fill="#ff9fb0"/>
      <ellipse class="m-blush" cx="144" cy="128" rx="13" ry="8" fill="#ff9fb0"/>
      <g class="m-eyes">
        <g class="m-eye"><ellipse cx="74" cy="108" rx="11" ry="14" fill="#2a1a3a"/><circle cx="78" cy="102" r="4.5" fill="#fff"/></g>
        <g class="m-eye"><ellipse cx="126" cy="108" rx="11" ry="14" fill="#2a1a3a"/><circle cx="130" cy="102" r="4.5" fill="#fff"/></g>
      </g>
      <path class="m-mouth m-happy" d="M84 132q16 20 32 0z" fill="#7a1024" stroke="#2a1a3a" stroke-width="5" stroke-linejoin="round"/>
      <ellipse class="m-mouth m-wow" cx="100" cy="138" rx="10" ry="12" fill="#7a1024" stroke="#2a1a3a" stroke-width="5"/>
      <path class="m-mouth m-sad" d="M86 142q14-14 28 0" fill="none" stroke="#2a1a3a" stroke-width="5" stroke-linecap="round"/>
    </g>
  </g>
</svg>`;

export function mascot(mood: Mood = 'happy') {
  const el = h('div', { class: 'mascot', html: SVG });
  setMood(el, mood);
  const eyes = el.querySelector('.m-eyes')!;
  gsap.set(eyes, { transformOrigin: '50% 50%' });
  // blink loop (fine to leave running; it only touches the eyes)
  const blink = () => {
    gsap.timeline({ onComplete: () => void (el.isConnected && gsap.delayedCall(gsap.utils.random(1.8, 4), blink)) })
      .to(eyes, { scaleY: 0.1, duration: 0.06 })
      .to(eyes, { scaleY: 1, duration: 0.12, ease: 'back.out(3)' });
  };
  gsap.delayedCall(1.5, blink);
  gsap.set(el.querySelector('.m-tassel'), { transformOrigin: '50% 0%' });
  gsap.to(el.querySelector('.m-tassel'), { rotation: 10, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  return el;
}

export function setMood(el: HTMLElement, mood: Mood) {
  el.dataset.mood = mood === 'idle' ? 'happy' : mood;
}
