/**
 * The cosmetic box machine: Deng Deng the lucky lantern (src/ui/mascot.ts) as a box, tinted per tier (漆 lacquer red,
 * 银 silver, 金 gold). Same contract as the HSK cabinet (cabinet.ts): a `.cab-seam` light runs down the middle, the
 * two lantern halves swing open like doors and the face pops off, revealing the glow inside (`.cab-inside`).
 */
import gsap from 'gsap';
import type { BoxDef } from '../../../shared/cosmetics';
import type { Machine } from './opening';

interface Tint {
  /** body gradient: light, mid, deep */
  body: [string, string, string];
  /** rib lines */
  rib: string;
  /** caps and trims */
  cap: [string, string];
  /** plaque glyph */
  glyph: string;
}

const TINTS: Record<BoxDef['id'], Tint> = {
  standard: { body: ['#ff7a86', '#e8344e', '#8f0f27'], rib: '#b81a33', cap: ['#ffe08a', '#d99a1c'], glyph: '漆' },
  select: { body: ['#ffffff', '#c9d3df', '#6f7d90'], rib: '#8e9bad', cap: ['#f4f7fb', '#9aa6b8'], glyph: '银' },
  supreme: { body: ['#fff4c2', '#f2c14e', '#a86a12'], rib: '#c58a1f', cap: ['#fff6d0', '#e9b23a'], glyph: '金' },
};

export const boxTint = (id: string): Tint => TINTS[id as BoxDef['id']] ?? TINTS.standard;

let uid = 0;

/** lantern SVG, viewBox 0 0 240 300 like the cabinet (the stage sizes and the seam flare line up) */
export function lanternSVG(boxId: string, cls = 'cab-svg') {
  const t = boxTint(boxId);
  const id = `ln${uid++}`;
  const ink = '#2a1a3a';
  // the body is an ellipse cut in two halves along x = 120
  const half = (side: 'l' | 'r') => {
    const d = `M120 76A98 96 0 0 ${side === 'l' ? 0 : 1} 120 268Z`;
    const rib = side === 'l' ? 'M84 82c-30 40-30 140 0 180M52 104c-18 30-18 106 0 136' : 'M156 82c30 40 30 140 0 180M188 104c18 30 18 106 0 136';
    const eye = side === 'l' ? '<ellipse cx="88" cy="160" rx="11" ry="14" fill="#2a1a3a"/><circle cx="92" cy="154" r="4.5" fill="#fff"/>' : '<ellipse cx="152" cy="160" rx="11" ry="14" fill="#2a1a3a"/><circle cx="156" cy="154" r="4.5" fill="#fff"/>';
    const blush = side === 'l' ? '<ellipse cx="68" cy="184" rx="13" ry="8" fill="#ff9fb0" opacity=".85"/>' : '<ellipse cx="172" cy="184" rx="13" ry="8" fill="#ff9fb0" opacity=".85"/>';
    const shine = side === 'l' ? '<ellipse cx="58" cy="128" rx="10" ry="22" fill="#fff" opacity=".5" transform="rotate(22 58 128)"/>' : '';
    return `<g class="cab-door cab-door-${side}">
      <path d="${d}" fill="url(#${id}-b)" stroke="${ink}" stroke-width="7" stroke-linejoin="round"/>
      <path d="${rib}" fill="none" stroke="${t.rib}" stroke-width="5" stroke-linecap="round"/>
      ${shine}<g class="ln-face">${blush}${eye}</g>
    </g>`;
  };
  return `
<svg class="${cls} ln-svg" viewBox="0 0 240 300" aria-hidden="true">
  <defs>
    <linearGradient id="${id}-b" x1="0" y1="0" x2=".4" y2="1">
      <stop offset="0" stop-color="${t.body[0]}"/><stop offset=".45" stop-color="${t.body[1]}"/><stop offset="1" stop-color="${t.body[2]}"/>
    </linearGradient>
    <linearGradient id="${id}-c" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${t.cap[0]}"/><stop offset="1" stop-color="${t.cap[1]}"/>
    </linearGradient>
    <radialGradient id="${id}-in" cx=".5" cy=".5" r=".6">
      <stop offset="0" stop-color="#fff"/><stop offset=".35" style="stop-color:var(--vglow,#ffe39a)"/><stop offset="1" style="stop-color:var(--vglow,#ffe39a)" stop-opacity=".2"/>
    </radialGradient>
    <filter id="${id}-bl" x="-2" y="-.2" width="5" height="1.4"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>
  <ellipse cx="120" cy="296" rx="80" ry="7" fill="#000" opacity=".3"/>
  <!-- hanger -->
  <path d="M120 0v40" stroke="${ink}" stroke-width="6"/>
  <circle cx="120" cy="34" r="8" fill="url(#${id}-c)" stroke="${ink}" stroke-width="4"/>
  <!-- glow inside, seen once the halves open -->
  <ellipse class="cab-inside" cx="120" cy="172" rx="92" ry="90" fill="url(#${id}-in)"/>
  ${half('l')}
  ${half('r')}
  <!-- seam light -->
  <g class="cab-seam">
    <rect x="113" y="80" width="14" height="184" style="fill:var(--vglow,#ffe39a)" filter="url(#${id}-bl)" opacity=".9"/>
    <rect x="118.5" y="84" width="3" height="176" fill="#fff"/>
  </g>
  <!-- mouth sits on the seam: it pops off with the plaque -->
  <g class="cab-lock">
    <path d="M106 190q14 18 28 0z" fill="#7a1024" stroke="${ink}" stroke-width="5" stroke-linejoin="round"/>
  </g>
  <!-- caps -->
  <g class="ln-cap">
    <rect x="72" y="44" width="96" height="26" rx="9" fill="url(#${id}-c)" stroke="${ink}" stroke-width="6"/>
    <rect x="96" y="40" width="48" height="34" rx="7" fill="#c3272d" stroke="${ink}" stroke-width="5"/>
    <text x="120" y="66" text-anchor="middle" font-family="Ma Shan Zheng, Noto Serif SC, serif" font-size="24" fill="#ffe08a">${t.glyph}</text>
  </g>
  <rect x="72" y="262" width="96" height="24" rx="9" fill="url(#${id}-c)" stroke="${ink}" stroke-width="6"/>
  <g class="cab-tassel ln-tassel"><path d="M110 286h20l5 14h-30z" fill="#ffc93c" stroke="${ink}" stroke-width="5" stroke-linejoin="round"/></g>
</svg>`;
}

/** a cosmetic box as a ceremony machine */
export function lanternMachine(box: BoxDef): Machine {
  return {
    svg: lanternSVG(box.id),
    open(svg) {
      const q = (s: string) => svg.querySelector(s)!;
      gsap.to(q('.cab-lock'), { y: 90, rotation: 40, opacity: 0, duration: 0.55, ease: 'power2.in', svgOrigin: '120 192' });
      gsap.to(q('.ln-cap'), { y: -70, rotation: -18, opacity: 0, duration: 0.6, ease: 'power2.out', svgOrigin: '120 56' });
      gsap.to(q('.cab-seam'), { opacity: 0, duration: 0.15 });
      gsap.fromTo(q('.cab-door-l'), { scaleX: 1, skewY: 0 }, { scaleX: -0.4, skewY: -8, duration: 0.55, ease: 'back.out(1.1)', svgOrigin: '24 172' });
      gsap.fromTo(q('.cab-door-r'), { scaleX: 1, skewY: 0 }, { scaleX: -0.4, skewY: 8, duration: 0.55, ease: 'back.out(1.1)', svgOrigin: '216 172' });
      gsap.fromTo(q('.cab-inside'), { opacity: 0.6 }, { opacity: 1, duration: 0.2 });
    },
  };
}
