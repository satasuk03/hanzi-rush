import '../src/style.css';
import '../src/games/gacha/vault.css';
import { renderIdentity } from '../src/cosmetics/render';
import { ITEMS } from '../shared/cosmetics';

const root = document.getElementById('root')!;
const title = { zh: '新', tier: 0 };
const mk = (cls: string, f: string, av: boolean, big = false) => {
  const d = document.createElement('div');
  d.className = 'bg ' + cls;
  const look = { frame: f, ...(av ? { avatar: 'avatar_panda' } : {}) };
  for (const s of big ? (['L'] as const) : (['S', 'M'] as const)) {
    const e = renderIdentity(look, s, { title });
    if (s === 'L') { const w = document.createElement('div'); w.className = 'pf-avatar'; w.append(e); d.append(w); } else d.append(e);
  }
  return d;
};
for (const it of ITEMS.filter((i) => i.slot === 'frame')) {
  const r = document.createElement('div');
  r.className = 'row';
  r.innerHTML = `<span class="nm">${it.id.slice(6)} (${it.rarity})</span>`;
  r.append(mk('w', it.id, true), mk('w', it.id, false), mk('y', it.id, false), mk('d', it.id, true, true), mk('d', it.id, false, true));
  root.append(r);
}
