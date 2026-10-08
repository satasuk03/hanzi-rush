/**
 * The cosmetic box machine: a 宝匣 treasure chest per tier. 漆匣 cinnabar lacquer with brass mounts, 银匣 silver with
 * blue enamel (银烧蓝), 金匣 gilt with imperial red panels, jade and a flaming pearl. A 盝顶 lid (flat top, sloped
 * sides), a 回纹 meander band, 祥云 cloud panels, a 海棠 lock plate with a barrel padlock and a red tassel, ring
 * handles and cloud feet. Same contract as the HSK cabinet (cabinet.ts): `.cab-seam` is the light along the lid,
 * `.cab-lock` drops, `.cab-inside` is the glow in the mouth of the chest. The lid swings back on its hinge.
 */
import gsap from 'gsap';
import type { BoxDef } from '../../../shared/cosmetics';
import type { Machine } from './opening';

interface Tint {
  /** body: light, mid, deep */
  body: [string, string, string];
  /** inset panels: light, deep */
  panel: [string, string];
  /** black-lacquer trims (base, top plate) */
  trim: [string, string];
  /** mounts: highlight, light, mid, shadow */
  metal: [string, string, string, string];
  /** engraving lines on the mounts */
  etch: string;
  /** inside of the lid and the mouth */
  inner: string;
  /** cabochons on the lid band; null = brass studs */
  gem: [string, string] | null;
  /** cartouche glyph */
  glyph: string;
}

const TINTS: Record<BoxDef['id'], Tint> = {
  standard: {
    body: ['#ff7466', '#d92b37', '#7d0c1f'],
    panel: ['#b81c2e', '#6a0a1a'],
    trim: ['#4a2a3e', '#1e1029'],
    metal: ['#fff6c9', '#f6cf5d', '#d1921f', '#8a5a0e'],
    etch: '#8a5a0e',
    inner: '#5c0816',
    gem: null,
    glyph: '漆',
  },
  select: {
    body: ['#8fd0ff', '#2f79d6', '#123778'],
    panel: ['#1f5fb8', '#0c2558'],
    trim: ['#3b4a6b', '#141c33'],
    metal: ['#ffffff', '#e4ebf3', '#a5b2c4', '#5d6b80'],
    etch: '#5d6b80',
    inner: '#0a1d45',
    gem: ['#ffffff', '#c9d6f0'],
    glyph: '银',
  },
  supreme: {
    body: ['#fff2b0', '#f0b93c', '#9a5a0c'],
    panel: ['#e0343a', '#7a0c1e'],
    trim: ['#7a1022', '#3a0614'],
    metal: ['#fffbe0', '#ffe07a', '#e3a22a', '#94560b'],
    etch: '#94560b',
    inner: '#5c0816',
    gem: ['#9dffd0', '#16a36a'],
    glyph: '金',
  },
  /** 套匣: jade-green lacquer with gold mounts */
  set: {
    body: ['#7be0b0', '#1f9e6e', '#0b5a3c'],
    panel: ['#178a5e', '#07402a'],
    trim: ['#1d4a3a', '#0a241b'],
    metal: ['#fffbe0', '#ffe07a', '#e3a22a', '#94560b'],
    etch: '#94560b',
    inner: '#06331f',
    gem: ['#ffe08a', '#d1921f'],
    glyph: '套',
  },
};

export const boxTint = (id: string): Tint => TINTS[id as BoxDef['id']] ?? TINTS.standard;

const INK = '#2a1a3a';
/** the lid hinge, on the back edge of the chest's mouth */
const HINGE = 136;

let uid = 0;

/** a 祥云 auspicious cloud centred on (x, y), drawn as gilt tracery */
const cloud = (x: number, y: number, s: number, flip = false) =>
  `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})">
    <path d="M-17 7c-6 0-8-8-2-10c0-7 9-9 12-3c2-7 13-7 14 0c6-2 11 4 7 9c4 1 4 4 0 4z" />
    <path d="M-7 3a4 4 0 1 1 6-3M6 1a3 3 0 1 0-4-2" />
    <path d="M14 7q7 3 9 9M-17 7q-4 4-2 8" />
  </g>`;

/** an L-shaped 包角 corner mount with a ruyi tip; (sx, sy) points it into the corner */
const corner = (x: number, y: number, sx: 1 | -1, sy: 1 | -1, fill: string) =>
  `<path transform="translate(${x} ${y}) scale(${sx} ${sy})" d="M0 0H25Q24 7 17 8Q9 8 8 14Q8 23 0 25Z" fill="${fill}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`;

/** a row of 泡钉 nail heads */
const studs = (x0: number, x1: number, y: number, n: number, fill: string) => {
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / (n - 1);
    s += `<circle cx="${x.toFixed(1)}" cy="${y}" r="2.8" fill="${fill}" stroke="${INK}" stroke-width="1.6"/><circle cx="${(x - 0.8).toFixed(1)}" cy="${y - 0.9}" r=".9" fill="#fff" opacity=".85"/>`;
  }
  return s;
};

/**
 * Chest SVG, viewBox 0 0 240 300 like the cabinet so the ceremony stage and the seam flare line up.
 * `crop` frames the chest alone (picker tabs).
 */
export function chestSVG(boxId: string, cls = 'cab-svg', crop = false) {
  const t = boxTint(boxId);
  const tier = boxId === 'supreme' ? 2 : boxId === 'select' ? 1 : 0;
  const id = `ch${uid++}`;
  const M = `url(#${id}-m)`;
  const [g0, g1] = t.gem ?? ['', ''];

  // body front: two 描金 cloud panels either side of the lock plate
  const panel = (x: number, flip: boolean) => `
    <rect x="${x}" y="160" width="48" height="72" rx="5" fill="url(#${id}-p)" stroke="${INK}" stroke-width="3"/>
    <rect x="${x + 4}" y="164" width="40" height="64" rx="3" fill="none" stroke="${M}" stroke-width="2"/>
    <g fill="none" stroke="${M}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${cloud(x + 24, 188, 0.92, flip)}${cloud(x + (flip ? 28 : 20), 211, 0.55, !flip)}</g>
    <path d="M${x + 8} 168v7M${x + 8} 168h7M${x + 40} 224v-7M${x + 40} 224h-7" stroke="${M}" stroke-width="2" stroke-linecap="round"/>`;

  // the ring handles on the ends
  const handle = (side: 1 | -1) => {
    const x = side < 0 ? 31 : 209;
    const d = `M${x} 170q${side * 20} 0 ${side * 20} 17q0 17 ${-side * 20} 17`;
    return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>
      <path d="${d}" fill="none" stroke="${M}" stroke-width="5" stroke-linecap="round"/>`;
  };

  // 海棠 quatrefoil lock plate: four discs, outlined as one shape (ink under, fill over)
  const lobes = (r: number, extra = '') =>
    [
      [120, 186],
      [131, 198],
      [120, 210],
      [109, 198],
    ]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" ${extra}/>`)
      .join('');

  const crest =
    tier === 2
      ? `<g class="ch-crest">
          <path d="M120 30c6 8 14 12 13 24c6-4 7-10 6-14c8 8 6 22-4 28H105c-10-6-12-20-4-28c-1 4 0 10 6 14c-1-12 7-16 13-24z" fill="url(#${id}-fl)" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
          <circle cx="120" cy="60" r="11" fill="url(#${id}-pl)" stroke="${INK}" stroke-width="3.5"/>
          <path d="M113 57a8 8 0 0 1 6-6" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
          <path d="M104 74h32l-4 6h-24z" fill="${M}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
        </g>`
      : tier === 1
        ? `<g class="ch-crest"><circle cx="120" cy="66" r="7.5" fill="url(#${id}-pl)" stroke="${INK}" stroke-width="3"/><path d="M110 76h20l-3 4h-14z" fill="${M}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/></g>`
        : '';

  const gems = t.gem
    ? [56, 184]
        .map(
          (x) => `<ellipse cx="${x}" cy="135" rx="8" ry="7" fill="${M}" stroke="${INK}" stroke-width="2.5"/>
            <ellipse cx="${x}" cy="135" rx="5" ry="4.5" fill="url(#${id}-gm)"/><ellipse cx="${x - 1.6}" cy="133.4" rx="1.8" ry="1.3" fill="#fff"/>`,
        )
        .join('')
    : '';

  const view = crop ? '6 26 228 266' : '0 0 240 300';
  return `
<svg class="${cls} ch-svg" viewBox="${view}" aria-hidden="true" data-tier="${tier}">
  <defs>
    <linearGradient id="${id}-b" x1="0" y1="0" x2=".35" y2="1">
      <stop offset="0" stop-color="${t.body[0]}"/><stop offset=".42" stop-color="${t.body[1]}"/><stop offset="1" stop-color="${t.body[2]}"/>
    </linearGradient>
    <linearGradient id="${id}-lt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${t.body[0]}"/><stop offset="1" stop-color="${t.body[1]}"/>
    </linearGradient>
    <linearGradient id="${id}-p" x1="0" y1="0" x2=".3" y2="1">
      <stop offset="0" stop-color="${t.panel[0]}"/><stop offset="1" stop-color="${t.panel[1]}"/>
    </linearGradient>
    <linearGradient id="${id}-t" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${t.trim[0]}"/><stop offset="1" stop-color="${t.trim[1]}"/>
    </linearGradient>
    <linearGradient id="${id}-m" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${t.metal[0]}"/><stop offset=".3" stop-color="${t.metal[1]}"/><stop offset=".55" stop-color="${t.metal[0]}"/><stop offset=".8" stop-color="${t.metal[2]}"/><stop offset="1" stop-color="${t.metal[1]}"/>
    </linearGradient>
    <radialGradient id="${id}-pl" cx=".38" cy=".35" r=".7">
      <stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="${tier === 2 ? '#ffe2ec' : '#eef3ff'}"/><stop offset="1" stop-color="${tier === 2 ? '#f08aa8' : '#9fb3d6'}"/>
    </radialGradient>
    <linearGradient id="${id}-fl" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe27a"/><stop offset=".5" stop-color="#ff8a2a"/><stop offset="1" stop-color="#e0283a"/>
    </linearGradient>
    <radialGradient id="${id}-gm" cx=".35" cy=".3" r=".8">
      <stop offset="0" stop-color="${g0}"/><stop offset="1" stop-color="${g1}"/>
    </radialGradient>
    <radialGradient id="${id}-jd" cx=".38" cy=".32" r=".75">
      <stop offset="0" stop-color="#c8ffe4"/><stop offset=".55" stop-color="#3fcf94"/><stop offset="1" stop-color="#0d7a4e"/>
    </radialGradient>
    <radialGradient id="${id}-in" cx=".5" cy=".75" r=".7">
      <stop offset="0" stop-color="#fff"/><stop offset=".35" style="stop-color:var(--vglow,#ffe39a)"/><stop offset="1" style="stop-color:var(--vglow,#ffe39a)" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}-li" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" style="stop-color:var(--vglow,#ffe39a)" stop-opacity=".85"/><stop offset=".6" stop-color="${t.inner}" stop-opacity="0"/>
    </linearGradient>
    <pattern id="${id}-mq" width="14" height="14" patternUnits="userSpaceOnUse" x="8" y="128">
      <path d="M2 13V2H12V12H5V5H9V9" fill="none" stroke="${t.metal[1]}" stroke-width="1.7" stroke-linecap="square"/>
    </pattern>
    <filter id="${id}-bl" x="-.2" y="-3" width="1.4" height="7"><feGaussianBlur stdDeviation="3.5"/></filter>
  </defs>

  <ellipse class="ch-shadow" cx="120" cy="287" rx="104" ry="8" fill="#000" opacity=".32"/>

  <!-- cloud feet, apron and plinth -->
  <path d="M28 262H62Q60 276 50 283Q40 288 33 281Q27 273 28 262Z" fill="url(#${id}-t)" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
  <path d="M212 262H178Q180 276 190 283Q200 288 207 281Q213 273 212 262Z" fill="url(#${id}-t)" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
  <path d="M38 271q8 4 14 0M202 271q-8 4-14 0" fill="none" stroke="${M}" stroke-width="2" stroke-linecap="round"/>
  <path d="M60 262H180Q176 275 162 275Q146 272 134 278Q127 282 120 278Q113 282 106 278Q94 272 78 275Q64 275 60 262Z" fill="url(#${id}-t)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
  <rect x="22" y="246" width="196" height="19" rx="5" fill="url(#${id}-t)" stroke="${INK}" stroke-width="5"/>
  <path d="M30 255.5H210" stroke="${M}" stroke-width="2.5" stroke-linecap="round"/>

  <!-- ring handles -->
  ${handle(-1)}${handle(1)}

  <!-- the mouth: back wall and the light inside, seen once the lid swings back -->
  <path d="M36 150L46 ${HINGE}H194L204 150Z" fill="${t.inner}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
  <ellipse class="cab-inside" cx="120" cy="140" rx="96" ry="34" fill="url(#${id}-in)" opacity="0"/>

  <!-- the open lid's underside, standing up behind the mouth -->
  <g class="ch-lid-in" opacity="0">
    <path d="M38 ${HINGE}L50 70H190L202 ${HINGE}Z" fill="${t.inner}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M38 ${HINGE}L50 70H190L202 ${HINGE}Z" fill="url(#${id}-li)"/>
    <path d="M50 ${HINGE - 6}L60 80H180L190 ${HINGE - 6}Z" fill="none" stroke="${M}" stroke-width="2.5" stroke-linejoin="round"/>
    <rect x="44" y="60" width="152" height="13" rx="4" fill="url(#${id}-b)" stroke="${INK}" stroke-width="4.5"/>
    <path d="M52 66.5H188" stroke="${M}" stroke-width="2" stroke-linecap="round"/>
  </g>

  <!-- body -->
  <rect x="30" y="146" width="180" height="104" rx="4" fill="url(#${id}-b)" stroke="${INK}" stroke-width="5.5"/>
  <rect x="35" y="151" width="5" height="90" rx="2.5" fill="#fff" opacity=".22"/>
  <path d="M33 240H207" stroke="${INK}" stroke-width="3" opacity=".55"/>
  ${studs(42, 198, 245, 11, M)}
  ${panel(38, false)}
  ${panel(154, true)}
  ${corner(30, 250, 1, -1, M)}${corner(210, 250, -1, -1, M)}

  <!-- 海棠 lock plate (jade 璧 disc on the gold chest) -->
  <g>
    ${lobes(14.5, `fill="${INK}"`)}
    ${lobes(11.5, `fill="${M}"`)}
    <circle cx="120" cy="198" r="9.5" fill="${tier === 2 ? `url(#${id}-jd)` : 'none'}" stroke="${t.etch}" stroke-width="2"/>
    ${tier === 2 ? '<circle cx="120" cy="198" r="3.2" fill="#0d5a3a"/><path d="M114 194a7 7 0 0 1 4-3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"/>' : `<path d="M120 189v18M111 198h18" stroke="${t.etch}" stroke-width="1.6" opacity=".6"/>`}
  </g>

  <!-- the lid -->
  <g class="ch-lid">
    <path d="M26 121L50 95H190L214 121Z" fill="url(#${id}-lt)" stroke="${INK}" stroke-width="5.5" stroke-linejoin="round"/>
    <path d="M42 117L56 102H184L198 117" fill="none" stroke="${M}" stroke-width="2" stroke-linejoin="round" opacity=".9"/>
    <path d="M58 104q-8 6-10 12M182 104q8 6 10 12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".25"/>
    <rect x="44" y="77" width="152" height="22" rx="6" fill="url(#${id}-t)" stroke="${INK}" stroke-width="5"/>
    <path d="M52 82.5H188" stroke="#fff" stroke-width="2" opacity=".2" stroke-linecap="round"/>
    ${studs(54, 86, 88, 4, M)}${studs(154, 186, 88, 4, M)}
    <rect x="92" y="77" width="56" height="22" rx="4" fill="${M}" stroke="${INK}" stroke-width="3.5"/>
    <rect x="96" y="80.5" width="48" height="15" rx="2.5" fill="${t.trim[1]}"/>
    <text class="ch-glyph" x="120" y="93.5" text-anchor="middle" font-family="Ma Shan Zheng, Noto Serif SC, serif" font-size="15" fill="${t.metal[1]}" letter-spacing="1">${t.glyph}匣</text>
    ${crest}
    <rect x="22" y="118" width="196" height="34" rx="6" fill="url(#${id}-b)" stroke="${INK}" stroke-width="5.5"/>
    <rect x="30" y="127" width="180" height="16" rx="2" fill="url(#${id}-t)"/>
    <rect x="30" y="127" width="180" height="16" rx="2" fill="url(#${id}-mq)"/>
    <path d="M30 125.5H210M30 144.5H210" stroke="${M}" stroke-width="2" stroke-linecap="round"/>
    <rect x="28" y="121" width="70" height="3" rx="1.5" fill="#fff" opacity=".28"/>
    ${gems}
    ${corner(22, 118, 1, 1, M)}${corner(218, 118, -1, 1, M)}${corner(22, 152, 1, -1, M)}${corner(218, 152, -1, -1, M)}
    <!-- ruyi hinge plate and the hasp that drops over the seam -->
    <path d="M102 125Q120 113 138 125Q142 136 132 142L120 148L108 142Q98 136 102 125Z" fill="${M}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M110 128q10-6 20 0" fill="none" stroke="${t.etch}" stroke-width="1.8" stroke-linecap="round"/>
    <rect x="112" y="138" width="16" height="36" rx="6" fill="${M}" stroke="${INK}" stroke-width="3.5"/>
    <rect x="116.5" y="157" width="7" height="12" rx="3" fill="${INK}"/>
  </g>

  <!-- seam light along the lid -->
  <g class="cab-seam">
    <rect x="30" y="146" width="180" height="8" style="fill:var(--vglow,#ffe39a)" filter="url(#${id}-bl)" opacity=".9"/>
    <rect x="40" y="150.8" width="160" height="1.8" rx=".9" fill="#fff" opacity=".75"/>
  </g>

  <!-- barrel padlock through the hasp, with its tassel -->
  <g class="cab-lock">
    <path d="M101 164v-6h38v6" fill="none" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
    <path d="M101 164v-6h38v6" fill="none" stroke="${M}" stroke-width="3.2" stroke-linejoin="round"/>
    <rect x="94" y="161" width="52" height="15" rx="7.5" fill="${M}" stroke="${INK}" stroke-width="3.5"/>
    <path d="M102 161v15M138 161v15" stroke="${t.etch}" stroke-width="2"/>
    <path d="M106 165H134" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/>
    <g class="ch-tassel">
      <path d="M143 173q3 5 3 11" fill="none" stroke="#c3272d" stroke-width="2.5"/>
      <circle cx="146" cy="187" r="4" fill="#e8344e" stroke="${INK}" stroke-width="2.5"/>
      <path d="M142 192h8l2.5 22h-13z" fill="#e8344e" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M141.5 195.5h9" stroke="${t.metal[1]}" stroke-width="3"/>
      <path d="M144.5 200v12M147.5 200v12" stroke="#9e1a2c" stroke-width="1.4"/>
    </g>
  </g>

  ${tier ? `<g class="ch-glints" fill="#fff"><path class="ch-glint" d="M60 92l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/><path class="ch-glint" d="M196 156l1.6 4.4 4.4 1.6-4.4 1.6-1.6 4.4-1.6-4.4-4.4-1.6 4.4-1.6z"/>${tier === 2 ? '<path class="ch-glint" d="M138 42l1.6 4.4 4.4 1.6-4.4 1.6-1.6 4.4-1.6-4.4-4.4-1.6 4.4-1.6z"/>' : ''}</g>` : ''}
</svg>`;
}

/** the lid hops on its hinge (idle teaser on the shop stage, and a tap) */
export function lidHop(svg: Element, big = false) {
  const lid = svg.querySelector('.ch-lid');
  const lock = svg.querySelector('.cab-lock');
  const inside = svg.querySelector('.cab-inside');
  if (!lid || !lock || !inside) return gsap.timeline();
  const h = big ? 12 : 7;
  return gsap
    .timeline()
    .to(lid, { y: -h, rotation: big ? -2 : -1, svgOrigin: `214 ${HINGE}`, duration: 0.12, ease: 'power2.out' })
    .to(inside, { opacity: big ? 0.9 : 0.7, duration: 0.12 }, 0)
    .to(lock, { rotation: big ? 9 : 5, svgOrigin: '120 160', duration: 0.12, ease: 'power2.out' }, 0)
    .to(lid, { y: 0, rotation: 0, duration: 0.45, ease: 'bounce.out' })
    .to(inside, { opacity: 0, duration: 0.3 }, '<0.08')
    .to(lock, { rotation: 0, duration: 0.9, ease: 'elastic.out(1.6,0.25)' }, '<');
}

/** a cosmetic box as a ceremony machine: the padlock drops, the lid swings back on its hinge and the light pours out */
export function chestMachine(box: BoxDef): Machine {
  return {
    svg: chestSVG(box.id),
    open(svg) {
      const q = (s: string) => svg.querySelector(s)!;
      gsap.killTweensOf([q('.ch-lid'), q('.cab-lock'), q('.cab-inside')]);
      gsap.to(q('.cab-lock'), { y: 110, rotation: 70, opacity: 0, duration: 0.6, ease: 'power2.in', svgOrigin: '120 168' });
      gsap.to(q('.cab-seam'), { opacity: 0, duration: 0.15 });
      gsap.set(q('.cab-inside'), { opacity: 1 });
      const glints = svg.querySelector('.ch-glints');
      if (glints) gsap.to(glints, { opacity: 0, duration: 0.1 });
      // the lid's front face folds towards the hinge, then its underside stands up behind the mouth
      const lid = q('.ch-lid');
      const under = q('.ch-lid-in');
      gsap.set([lid, under], { svgOrigin: `120 ${HINGE}` });
      gsap.set(under, { scaleY: 0 });
      gsap
        .timeline()
        .to(lid, { scaleY: 0, y: -6, duration: 0.16, ease: 'power2.in' })
        .set(lid, { opacity: 0 })
        .set(under, { opacity: 1 })
        .to(under, { scaleY: 1, duration: 0.5, ease: 'back.out(2.2)' });
    },
  };
}
