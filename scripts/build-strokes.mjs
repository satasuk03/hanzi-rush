// Bake hanzi-writer-data (Make Me a Hanzi, Arphic Public License) into one JSON file per HSK level:
//   public/data/strokes/hsk{n}.json  ->  { "<char>": { s: string[] (SVG paths, y-up), m: number[][][] (medians, y-up) } }
// Words with a Han character that has no stroke data are logged; the game skips them.
// Deterministic: keys are sorted, no timestamps.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PKG = path.join(root, 'node_modules/hanzi-writer-data');
const OUT = path.join(root, 'public/data/strokes');
fs.mkdirSync(OUT, { recursive: true });

const HAN = /\p{Script=Han}/gu;
const cache = new Map();
function glyph(ch) {
  if (cache.has(ch)) return cache.get(ch);
  const f = path.join(PKG, `${ch}.json`);
  let g = null;
  if (fs.existsSync(f)) {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    g = { s: d.strokes, m: d.medians };
  }
  cache.set(ch, g);
  return g;
}

for (let n = 1; n <= 6; n++) {
  const words = JSON.parse(fs.readFileSync(path.join(root, `public/data/hsk${n}.json`), 'utf8'));
  const chars = new Set();
  for (const w of words) for (const c of w.h.match(HAN) ?? []) chars.add(c);
  const out = {};
  const missing = new Set();
  for (const c of [...chars].sort()) {
    const g = glyph(c);
    if (g) out[c] = g;
    else missing.add(c);
  }
  const excluded = words.filter((w) => (w.h.match(HAN) ?? []).some((c) => missing.has(c)));
  fs.writeFileSync(path.join(OUT, `hsk${n}.json`), JSON.stringify(out));
  console.log(`hsk${n}: ${Object.keys(out).length} chars, ${excluded.length}/${words.length} words excluded` +
    (excluded.length ? ` [${excluded.map((w) => w.h).join(' ')}]` : '') +
    (missing.size ? ` missing chars [${[...missing].join(' ')}]` : ''));
}
fs.copyFileSync(path.join(PKG, 'ARPHICPL.TXT'), path.join(OUT, 'ARPHICPL.txt'));
console.log('wrote ARPHICPL.txt');
