import '../src/style.css';
import { ITEMS } from '../shared/cosmetics';
import { renderBadges } from '../src/cosmetics/render';

const app = document.getElementById('app')!;
const items = ITEMS.filter((i) => i.slot === 'badge');
for (const [cls, zoom] of [['dark', ''], ['card', ''], ['dark z3', ''], ['card z3', '']] as const) {
  const sec = document.createElement('div');
  sec.className = `sec ${cls}`;
  for (const it of items) {
    const c = document.createElement('div');
    c.className = 'c';
    const el = renderBadges({ badges: [it.id] }, 'L');
    if (el) c.append(el);
    c.append(`${it.rarity} ${it.id.slice(6)}`);
    sec.append(c);
  }
  app.append(sec);
}
