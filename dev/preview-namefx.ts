// Dev-only: every name effect on a Latin, Thai and Chinese name, on a board row and on the profile card.
import '../src/style.css';
import '../src/games/gacha/vault.css';
import '../src/cosmetics/identity.css';
import { ITEMS } from '../shared/cosmetics';
import { applyNameFx } from '../src/cosmetics/render';

const NAMES = ['Panda Ken', 'น้องหมีแพนด้า', '小熊猫王'];
const fxs = ITEMS.filter((i) => i.slot === 'nameFx');
const root = document.getElementById('app')!;
root.style.cssText = 'padding:12px;font-family:Nunito,Mitr,sans-serif';

const mk = (cls: string, ids: string, anim: boolean, name: string, me = false) => {
  const row = document.createElement('div');
  row.className = cls + (me ? ' me' : '');
  const nm = document.createElement('span');
  nm.className = 'lb-nm';
  nm.textContent = name;
  applyNameFx(nm, { nameFx: ids } as never, anim);
  if (cls === 'lb-row') {
    row.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:4px 10px;width:150px';
    const n = document.createElement('div');
    n.className = 'lb-name';
    n.append(nm);
    row.append(n);
  } else {
    row.style.cssText = 'padding:8px;width:210px;text-align:center;font:400 22px/1.2 var(--f-display)';
    row.className = 'pf-card';
    row.style.margin = '0';
    row.style.display = 'block';
    nm.className = 'pf-nm';
    applyNameFx(nm, { nameFx: ids } as never, anim);
    row.append(nm);
  }
  return row;
};

const grid = document.createElement('div');
grid.style.cssText = 'display:grid;grid-template-columns:130px repeat(4,auto);gap:6px 10px;align-items:center;justify-content:start';
for (const f of fxs) {
  const lab = document.createElement('div');
  lab.style.cssText = 'font:700 12px sans-serif';
  lab.textContent = `${f.id} r${f.rarity} ${f.zh}`;
  grid.append(lab);
  const col = document.createElement('div');
  col.style.cssText = 'display:grid;gap:4px';
  for (const n of NAMES) col.append(mk('lb-row', f.id, false, n));
  const col2 = document.createElement('div');
  col2.style.cssText = 'display:grid;gap:4px';
  for (const n of NAMES) col2.append(mk('lb-row', f.id, true, n, true));
  const col3 = document.createElement('div');
  col3.style.cssText = 'display:grid;gap:4px';
  for (const n of NAMES) col3.append(mk('pf', f.id, false, n));
  const col4 = document.createElement('div');
  col4.style.cssText = 'display:grid;gap:4px';
  for (const n of NAMES) col4.append(mk('pf', f.id, true, n));
  grid.append(col, col2, col3, col4);
}
root.append(grid);
