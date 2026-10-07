import '../src/style.css';
import '../src/games/gacha/vault.css';
import '../src/games/gacha/shop.css';
import { chestSVG, chestMachine, lidHop } from '../src/games/gacha/chest';
import { BOXES, ITEMS } from '../shared/cosmetics';
import { drawTreasureBack, drawTreasureFront } from '../src/games/gacha/treasureArt';
import { itemArt } from '../src/games/gacha/cosmeticReveal';
import { COSMETIC_STAGE } from '../src/games/gacha/cardArt';

const $ = (id: string) => document.getElementById(id)!;
const draw = () => {
  $('big').innerHTML = BOXES.map((b) => `<div class="big shop-chest">${chestSVG(b.id)}</div>`).join('');
  $('small').innerHTML = BOXES.map((b) => `<div class="small">${chestSVG(b.id, 'sb-svg', true)}</div>`).join('');
  $('lite').innerHTML = BOXES.map((b) => `<div class="small" style="width:90px">${chestSVG(b.id, 'sb-svg', true)}</div>`).join('');
};
draw();
const svgs = () => [...document.querySelectorAll('#big .cab-svg')];
$('hop').onclick = () => svgs().forEach((s) => lidHop(s, true));
$('open').onclick = () => svgs().forEach((s, i) => chestMachine(BOXES[i]).open(s));
$('reset').onclick = draw;
($('glow') as HTMLSelectElement).onchange = (e) => document.querySelectorAll<HTMLElement>('.big').forEach((b) => b.style.setProperty('--vglow', (e.target as HTMLSelectElement).value));

const W = 230;
const picks = ['frame', 'avatar', 'nameFx', 'badge', 'avatar'] as const;
document.fonts.ready.then(() => setTimeout(() => {
  for (let r = 0; r < 5; r++) {
    const it = ITEMS.find((i) => i.rarity === r && i.slot === picks[r]) ?? ITEMS.find((i) => i.rarity === r)!;
    const d = document.createElement('div');
    d.className = 'face';
    d.style.setProperty('--cw', W + 'px');
    d.append(drawTreasureFront(document.createElement('canvas'), W, r, { key: it.id, zh: it.zh, name: it.en, kind: it.slot.toUpperCase() }, 'en'));
    const st = document.createElement('div');
    st.className = 'cos-stage';
    st.style.top = COSMETIC_STAGE.y * 100 + '%';
    st.append(itemArt(it));
    d.append(st);
    $('faces').append(d);
  }
  for (const b of BOXES) {
    const d = document.createElement('div');
    d.className = 'face';
    d.append(drawTreasureBack(document.createElement('canvas'), W, b.id));
    $('backs').append(d);
  }
}, 300));
