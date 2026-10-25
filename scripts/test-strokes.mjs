// Stroke Master data + matcher: `npm run test:strokes` (docs/stroke-master.md section 5), HSK 1-3.
//  1. coverage: every word's Han characters have stroke data
//  2. sloppy correct strokes are accepted (leniency 1.15)
//  3. reversed strokes are rejected as 'backwards'
//  4. later strokes drawn when stroke i is expected are rejected
//  5. targeting picks the expected word among words sharing a first stroke
// Seeded RNG, so results are reproducible.
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const tmp = mkdtempSync(join(tmpdir(), 'hr-strokes-'));
let failed = false;
try {
  await build({
    entryPoints: { matcher: 'src/games/stroke/matcher.ts', api: 'shared/api.ts', strokes: 'src/core/strokes.ts' },
    bundle: true, format: 'esm', platform: 'node', outdir: tmp, outExtension: { '.js': '.mjs' }, logLevel: 'error',
  });
  const M = await import(pathToFileURL(join(tmp, 'matcher.mjs')).href);
  const S = await import(pathToFileURL(join(tmp, 'strokes.mjs')).href);
  const API = await import(pathToFileURL(join(tmp, 'api.mjs')).href);

  const LV = 1.15;
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const HAN = /\p{Script=Han}/gu;
  const json = (f) => JSON.parse(readFileSync(f, 'utf8'));
  const ok = (name) => console.log('ok  ' + name);
  const pct = (a, b) => `${a}/${b} (${b ? ((100 * a) / b).toFixed(2) : '-'}%)`;

  const levels = [1, 2, 3].map((n) => ({ n, words: json(`public/data/hsk${n}.json`), data: json(`public/data/strokes/hsk${n}.json`) }));

  // sloppy human-ish stroke: offset, scale, jitter, densified
  const sloppy = (med) => {
    const dx = (rnd() - 0.5) * 120, dy = (rnd() - 0.5) * 120, sc = 0.85 + rnd() * 0.25;
    const dense = [];
    for (let k = 0; k < med.length - 1; k++) {
      for (let s = 0; s < 6; s++) {
        const a = med[k], b = med[k + 1];
        dense.push([a[0] + ((b[0] - a[0]) * s) / 6, a[1] + ((b[1] - a[1]) * s) / 6]);
      }
    }
    dense.push(med.at(-1));
    return dense.map(([x, y]) => [512 + (x - 512) * sc + dx + (rnd() - 0.5) * 30, 512 + (y - 512) * sc + dy + (rnd() - 0.5) * 30]);
  };

  // ---- 1. coverage
  for (const { n, words, data } of levels) {
    const excluded = words.filter((w) => S.missingChars(w.h, data).length);
    assert.deepEqual(excluded.map((w) => w.h), [], `hsk${n}: words missing stroke data`);
    for (const w of words) for (const c of w.h.match(HAN) ?? []) assert.ok(S.glyphOf(c, data), `${c} has a glyph`);
  }
  ok('coverage: every HSK 1-3 word has stroke data for all its characters');

  // ---- 1b. stroke cap (checkRun rejects words above STROKE.maxWordStrokes; StrokeGame also filters them)
  let maxStrokes = 0, maxWord = '';
  for (const { n, words, data } of levels) {
    for (const w of words) {
      const total = (w.h.match(HAN) ?? []).reduce((a, c) => a + S.glyphOf(c, data).n, 0);
      assert.ok(total <= API.STROKE.maxWordStrokes, `hsk${n} ${w.h}: ${total} strokes > ${API.STROKE.maxWordStrokes}`);
      if (total > maxStrokes) [maxStrokes, maxWord] = [total, w.h];
    }
  }
  ok(`every playable HSK 1-3 word <= ${API.STROKE.maxWordStrokes} strokes (max ${maxStrokes}: ${maxWord})`);

  // ---- 2-4 per level (unique characters of the level)
  const t2 = [], t3 = [], t4 = [];
  let totalRejectedOrder = 0;
  for (const { n, data } of levels) {
    const row = { n, chars: 0, strokes: 0, acc: 0, bwT: 0, bwOk: 0, woT: 0, woOk: 0 };
    const accFail = [], bwFail = [], woFail = new Map();
    for (const ch of Object.keys(data).sort()) {
      const g = S.glyphOf(ch, data);
      row.chars++;
      for (let i = 0; i < g.n; i++) {
        row.strokes++;
        const u = sloppy(g.med[i]);
        const r = M.grade(u, g.med, i, LV);
        if (r.ok) row.acc++; else accFail.push(`${ch}#${i}:${r.why}:${Math.round(r.avg)}`);
        row.bwT++;
        const b = M.grade(u.slice().reverse(), g.med, i, LV);
        if (!b.ok && b.why === 'backwards') row.bwOk++; else if (!b.ok) bwFail.push(`${ch}#${i}:${b.why}`); else bwFail.push(`${ch}#${i}:accepted`);
        for (let j = i + 1; j < g.n; j++) {
          row.woT++;
          if (!M.grade(g.med[j], g.med, i, LV).ok) row.woOk++;
          else woFail.set(ch, (woFail.get(ch) ?? 0) + 1);
        }
      }
    }
    t2.push({ row, accFail }); t3.push({ row, bwFail }); t4.push({ row, woFail });
    totalRejectedOrder += row.woT - row.woOk;
  }
  console.log('\n2. sloppy correct strokes accepted (leniency 1.15)');
  for (const { row, accFail } of t2) {
    console.log(`  hsk${row.n}: ${row.chars} chars, ${row.strokes} strokes: accepted ${pct(row.acc, row.strokes)}${accFail.length ? '\n    fails: ' + accFail.join(' ') : ''}`);
  }
  console.log('\n3. reversed strokes rejected as backwards');
  for (const { row, bwFail } of t3) {
    console.log(`  hsk${row.n}: ${pct(row.bwOk, row.bwT)}${bwFail.length ? '\n    exceptions (nearly symmetric or other): ' + bwFail.join(' ') : ''}`);
  }
  console.log('\n4. wrong-order strokes (median j>i drawn at stroke i) rejected');
  for (const { row, woFail } of t4) {
    const lst = [...woFail].map(([c, k]) => `${c}x${k}`).join(' ');
    console.log(`  hsk${row.n}: ${pct(row.woOk, row.woT)}${lst ? '\n    ambiguous characters (accepted pairs): ' + lst : ''}`);
  }
  // Floors guard against regressions; the printed numbers are the record.
  for (const { row } of t2) assert.ok(row.acc / row.strokes >= 0.99, `hsk${row.n}: sloppy accept rate ${pct(row.acc, row.strokes)} below 99%`);
  for (const { row } of t3) assert.ok(row.bwOk / row.bwT >= 0.97, `hsk${row.n}: backwards reject rate below 97%`);
  for (const { row } of t4) assert.ok(row.woOk / row.woT >= 0.99, `hsk${row.n}: wrong-order reject rate below 99%`);
  ok('2-4 thresholds (accept >= 99%, backwards >= 97%, order >= 99%)');

  // ---- 5. targeting: unlocked stroke goes to the accepting word with the lowest avg - 45*depth
  console.log('\n5. targeting across words sharing a first stroke (equal depth)');
  const firstOf = (w, data) => S.glyphOf(w.h.match(HAN)[0], data);
  for (const { n, words, data } of levels) {
    const live = words.map((w) => ({ w, g: firstOf(w, data) }));
    let pairs = 0, right = 0, ties = 0, sloppyPairs = 0, sloppyRight = 0;
    const wrong = [];
    for (const A of live) {
      const exact = A.g.med[0];
      const accepting = live
        .map((c) => ({ c, r: M.grade(exact, c.g.med, 0, LV) }))
        .filter((x) => x.r.ok);
      assert.ok(accepting.some((x) => x.c === A), `${A.w.h}: own first stroke accepted`);
      for (const x of accepting) {
        if (x.c.g.ch === A.g.ch) continue; // same first character: indistinguishable by design
        pairs++;
        // two-word screen: A vs the competing word
        const best = [A, x.c].map((c) => ({ c, s: M.grade(exact, c.g.med, 0, LV).avg })).sort((p, q) => p.s - q.s)[0];
        if (best.c === A) right++;
        else if (best.s === 0) ties++;
        else wrong.push(`${A.w.h}>${x.c.w.h}`);
        const u = sloppy(exact);
        const ra = M.grade(u, A.g.med, 0, LV), rb = M.grade(u, x.c.g.med, 0, LV);
        if (ra.ok) { sloppyPairs++; if (!rb.ok || ra.avg <= rb.avg) sloppyRight++; }
      }
    }
    console.log(`  hsk${n}: exact stroke picks the written word in ${pct(right, pairs)} competing pairs, ${ties} identical-median ties; sloppy ${pct(sloppyRight, sloppyPairs)}${wrong.length ? '\n    wrong: ' + wrong.join(' ') : ''}`);
    assert.equal(wrong.length, 0, `hsk${n}: exact stroke must pick its own word`);
  }
  ok('targeting: an exact first stroke always selects its own word');
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
