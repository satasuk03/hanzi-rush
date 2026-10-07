/**
 * Render avatar SVGs (assets/avatars/*.svg) to 256 px WebP (public/avatars/*.webp) with headless Chrome + cwebp.
 *
 *   node scripts/build-avatars.mjs              all avatars
 *   node scripts/build-avatars.mjs fox panda    only these ids
 *   node scripts/build-avatars.mjs --sheet      also write assets/avatars/.build/sheet.png (contact sheet, circle crop)
 *
 * Needs Google Chrome (override with CHROME=/path) and cwebp (brew install webp).
 * PNG previews (512 px) land in assets/avatars/.build/, which is git-ignored.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets/avatars');
const build = join(src, '.build');
const out = join(root, 'public/avatars');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MAX_KB = 20;

const args = process.argv.slice(2);
const sheet = args.includes('--sheet');
const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
const wanted = args.filter((a) => !a.startsWith('--'));
const ids = (wanted.length ? wanted : manifest.map((m) => m.id)).filter((id) => existsSync(join(src, `${id}.svg`)));

mkdirSync(build, { recursive: true });
mkdirSync(out, { recursive: true });

const chrome = (shot, url, size) => {
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2', `--window-size=${size}`, `--screenshot=${shot}`, url], { stdio: 'ignore' });
  if (r.status !== 0 || !existsSync(shot)) throw new Error(`chrome failed for ${url}`);
};

let failed = 0;
for (const id of ids) {
  try {
    const png = join(build, `${id}.png`);
    const webp = join(out, `${id}.webp`);
    chrome(png, pathToFileURL(join(src, `${id}.svg`)).href, '256,256');
    const c = spawnSync('cwebp', ['-q', '88', '-resize', '256', '256', png, '-o', webp], { stdio: 'ignore' });
    if (c.status !== 0) throw new Error('cwebp failed');
    const kb = statSync(webp).size / 1024;
    console.log(`${id.padEnd(11)} ${kb.toFixed(1).padStart(5)} KB${kb > MAX_KB ? `  OVER ${MAX_KB} KB` : ''}`);
    if (kb > MAX_KB) failed++;
  } catch (e) {
    console.error(`${id}: ${e.message}`);
    failed++;
  }
}

if (sheet) {
  const NAMES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'];
  const items = manifest.filter((m) => existsSync(join(out, `${m.id}.webp`)));
  const cells = items
    .map((m) => `<figure><img src="${pathToFileURL(join(out, `${m.id}.webp`)).href}"><figcaption>${m.zh} ${m.en}<br><small>${NAMES[m.rarity]}</small></figcaption></figure>`)
    .join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:16px;background:#2a1a3a;font:13px system-ui,sans-serif;color:#f3e3c3;display:grid;grid-template-columns:repeat(6,160px);gap:14px}
    figure{margin:0;text-align:center}img{width:150px;height:150px;border-radius:50%;box-shadow:0 0 0 3px #f2c14e}small{opacity:.7}
  </style>${cells}`;
  const page = join(build, 'sheet.html');
  writeFileSync(page, html);
  const rows = Math.ceil(items.length / 6);
  chrome(join(build, 'sheet.png'), pathToFileURL(page).href, `1030,${rows * 205 + 40}`);
  console.log(`sheet: ${join(build, 'sheet.png')}`);
}

process.exit(failed ? 1 : 0);
