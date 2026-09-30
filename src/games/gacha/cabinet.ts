/**
 * Treasure cabinet (宝阁) per HSK level: lacquered body, pagoda eave, lattice doors that
 * swing open, a coin lock, and a door seam whose light colour (--vglow) teases the rarity.
 */
import type { LevelMeta } from '../../core/data';
import { mixHex } from '../../core/util';

export const HALLS = ['初心', '青云', '碧玉', '紫霄', '赤霞', '金龙'];
export const NUMERALS = ['壹', '贰', '叁', '肆', '伍', '陆'];

let uid = 0;

const lattice = (x: number, y: number, w: number, h: number) => {
  // 冰裂/方格 window lattice: a diamond grid clipped to the panel
  let d = '';
  const s = 13;
  for (let k = -h; k < w + h; k += s) {
    d += `M${x + k} ${y}l${h} ${h}`;
    d += `M${x + k} ${y + h}l${h} ${-h}`;
  }
  return d;
};

export function cabinetSVG(L: LevelMeta) {
  const id = `cab${uid++}`;
  const top = L.color;
  const mid = L.dark;
  const deep = mixHex(L.dark, '#1a0b22', 0.6);
  const door = (x: number, cls: string) => `
    <g class="${cls}">
      <rect x="${x}" y="106" width="68" height="142" rx="3" fill="url(#${id}-lq)" stroke="#1a0f24" stroke-width="4"/>
      <rect x="${x + 8}" y="116" width="52" height="60" rx="3" fill="${deep}" stroke="url(#${id}-au)" stroke-width="3"/>
      <path d="${lattice(x + 8, 116, 52, 60)}" stroke="url(#${id}-au)" stroke-width="2" opacity=".7" clip-path="url(#${id}-cp${cls.slice(-1)})"/>
      <rect x="${x + 8}" y="184" width="52" height="54" rx="3" fill="${deep}" stroke="url(#${id}-au)" stroke-width="3"/>
      <circle cx="${x + 34}" cy="211" r="15" fill="none" stroke="url(#${id}-au)" stroke-width="2.5"/>
      <path d="M${x + 34} 199a12 12 0 0 1 0 24a6 6 0 0 1 0-12a6 6 0 0 0 0-12z" fill="url(#${id}-au)" opacity=".9"/>
      <rect x="${x + 3}" y="110" width="4" height="134" rx="2" fill="#fff" opacity=".12"/>
    </g>`;
  return `
<svg class="cab-svg" viewBox="0 0 240 300" aria-hidden="true">
  <defs>
    <linearGradient id="${id}-lq" x1="0" y1="0" x2=".35" y2="1">
      <stop offset="0" stop-color="${top}"/><stop offset=".45" stop-color="${mid}"/><stop offset="1" stop-color="${deep}"/>
    </linearGradient>
    <linearGradient id="${id}-au" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff6c9"/><stop offset=".3" stop-color="#f1c451"/><stop offset=".55" stop-color="#fff0b0"/><stop offset=".8" stop-color="#b47a1c"/><stop offset="1" stop-color="#f7d57a"/>
    </linearGradient>
    <radialGradient id="${id}-in" cx=".5" cy=".5" r=".6">
      <stop offset="0" stop-color="#fff"/><stop offset=".35" style="stop-color:var(--vglow,#ffe39a)"/><stop offset="1" style="stop-color:var(--vglow,#ffe39a)" stop-opacity=".2"/>
    </radialGradient>
    <filter id="${id}-bl" x="-2" y="-.2" width="5" height="1.4"><feGaussianBlur stdDeviation="5"/></filter>
    <clipPath id="${id}-cpl"><rect x="60" y="116" width="52" height="60" rx="3"/></clipPath>
    <clipPath id="${id}-cpr"><rect x="128" y="116" width="52" height="60" rx="3"/></clipPath>
  </defs>
  <ellipse cx="120" cy="290" rx="96" ry="9" fill="#000" opacity=".35"/>
  <!-- feet + plinth -->
  <path d="M46 266h22l-4 20h-14zM172 266h22l-4 20h-14z" fill="${deep}" stroke="#1a0f24" stroke-width="4" stroke-linejoin="round"/>
  <rect x="28" y="254" width="184" height="16" rx="5" fill="url(#${id}-au)" stroke="#1a0f24" stroke-width="4"/>
  <!-- body -->
  <rect x="38" y="92" width="164" height="166" rx="8" fill="url(#${id}-lq)" stroke="#1a0f24" stroke-width="5"/>
  <rect x="44" y="98" width="152" height="154" rx="5" fill="none" stroke="url(#${id}-au)" stroke-width="2.5"/>
  <!-- interior light (seen when doors open) -->
  <rect class="cab-inside" x="52" y="106" width="136" height="142" rx="3" fill="url(#${id}-in)"/>
  ${door(52, 'cab-door cab-door-l')}
  ${door(120, 'cab-door cab-door-r')}
  <!-- seam light -->
  <g class="cab-seam">
    <rect x="113" y="104" width="14" height="146" style="fill:var(--vglow,#ffe39a)" filter="url(#${id}-bl)" opacity=".9"/>
    <rect x="118.5" y="106" width="3" height="142" fill="#fff"/>
  </g>
  <!-- coin lock -->
  <g class="cab-lock">
    <circle cx="120" cy="178" r="17" fill="url(#${id}-au)" stroke="#1a0f24" stroke-width="4"/>
    <circle cx="120" cy="178" r="11.5" fill="none" stroke="#9e6614" stroke-width="2"/>
    <text x="120" y="184" text-anchor="middle" font-family="Ma Shan Zheng, Noto Serif SC, serif" font-size="17" fill="#7a0d1d">${NUMERALS[L.n - 1]}</text>
  </g>
  <!-- eave -->
  <path d="M8 98Q42 94 62 70H178Q198 94 232 98Q238 104 228 106H12Q2 104 8 98Z" fill="${deep}" stroke="#1a0f24" stroke-width="5" stroke-linejoin="round"/>
  <path d="M14 101H226" stroke="url(#${id}-au)" stroke-width="3" stroke-linecap="round"/>
  <path d="M8 98q-6-8 2-14M232 98q6-8-2-14" fill="none" stroke="#1a0f24" stroke-width="5" stroke-linecap="round"/>
  <path d="M8 98q-6-8 2-14M232 98q6-8-2-14" fill="none" stroke="url(#${id}-au)" stroke-width="2.4" stroke-linecap="round"/>
  <rect x="64" y="54" width="112" height="20" rx="5" fill="url(#${id}-lq)" stroke="#1a0f24" stroke-width="4.5"/>
  <path d="M70 60h100" stroke="#fff" stroke-width="2.5" opacity=".25" stroke-linecap="round"/>
  <!-- pearl on the ridge -->
  <circle cx="120" cy="40" r="11" fill="url(#${id}-au)" stroke="#1a0f24" stroke-width="4"/>
  <circle cx="116" cy="36" r="3" fill="#fff" opacity=".8"/>
  <path d="M106 50q14-8 28 0" fill="none" stroke="#1a0f24" stroke-width="4" stroke-linecap="round"/>
  <!-- plaque -->
  <rect x="93" y="72" width="54" height="26" rx="4" fill="#1a0f24"/>
  <rect x="96" y="75" width="48" height="20" rx="3" fill="url(#${id}-au)"/>
  <text x="120" y="91" text-anchor="middle" font-family="Ma Shan Zheng, Noto Serif SC, serif" font-size="17" fill="#7a0d1d" letter-spacing="2">${HALLS[L.n - 1]}</text>
  <!-- tassels -->
  <g class="cab-tassel"><path d="M24 106v14" stroke="#1a0f24" stroke-width="2.5"/><path d="M20 120h8l2 16h-12z" fill="#e8344e" stroke="#1a0f24" stroke-width="2.5" stroke-linejoin="round"/></g>
  <g class="cab-tassel"><path d="M216 106v14" stroke="#1a0f24" stroke-width="2.5"/><path d="M212 120h8l2 16h-12z" fill="#e8344e" stroke="#1a0f24" stroke-width="2.5" stroke-linejoin="round"/></g>
</svg>`;
}
