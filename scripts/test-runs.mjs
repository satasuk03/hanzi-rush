// Stroke Master ranked verification (checkRun + validateSubmit + board keys): `npm run test:runs`. Pure, no D1.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const tmp = mkdtempSync(join(tmpdir(), 'hr-runs-'));
await build({
  entryPoints: { validate: 'server/validate.ts', api: 'shared/api.ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outdir: tmp,
  outExtension: { '.js': '.mjs' },
  logLevel: 'error',
});
const imp = (n) => import(pathToFileURL(join(tmp, n + '.mjs')).href);
const A = await imp('api');
const V = await imp('validate');
const ok = (name) => console.log('ok  ' + name);

const sum = (t) => t.reduce((a, [s, c, p]) => a + A.strokeWordPoints(s, c, p), 0);
/** landed = words that hit the ground; zen forces asked = 20 */
const mkRun = (tuples, landed, mode = 'rush', extra = {}) => {
  const strokes = tuples.reduce((a, t) => a + t[0], 0);
  return {
    board: A.boardKey('stroke', 2, mode),
    score: sum(tuples),
    correct: tuples.length,
    asked: tuples.length + landed,
    maxCombo: tuples.reduce((m, t) => Math.max(m, t[1]), 0),
    durationMs: A.SCORING.countdownMs + strokes * 150 + 60_000,
    strokeWords: tuples,
    ...extra,
  };
};
const rushT = [[5, 1, 1], [8, 2, 0], [3, 3, 1], [6, 1, 1], [4, 2, 1]];
const zenT = Array.from({ length: 17 }, (_, i) => [4 + (i % 5), (i % 6) + 1, i % 2]);

// 1
assert.equal(A.checkRun(mkRun(rushT, 3)), null);
assert.equal(A.checkRun(mkRun(rushT, 3), false), null);
ok('legit stroke rush');
// 2
assert.equal(A.checkRun(mkRun(zenT, 3, 'zen')), null);
assert.equal(A.checkRun(mkRun(zenT, 2, 'zen')), 'zen_total');
ok('legit zen, zen_total');
// 3
for (const d of [10, -10]) assert.equal(A.checkRun({ ...mkRun(rushT, 3), score: sum(rushT) + d }), 'score_mismatch');
ok('score mismatch');
// 4
assert.equal(A.checkRun({ ...mkRun(rushT, 3), strokeWords: rushT.slice(1) }), 'words_len');
assert.equal(A.checkRun({ ...mkRun(rushT, 3), strokeWords: undefined }), 'words_missing');
assert.equal(A.checkRun({ ...mkRun(rushT, 3), board: 'quiz:2:rush' }), 'words_scope');
ok('words_len / words_missing / words_scope');
// 5
const withT = (t) => mkRun(t, 3);
assert.equal(A.checkRun(withT([[5, 2, 1], [5, 1, 1], [5, 1, 1]])), 'combo_seq');
assert.equal(A.checkRun(withT([[5, 1, 1], [5, 2, 1], [5, 3, 1], [5, 5, 1], [5, 1, 1]])), 'combo_seq');
assert.equal(A.checkRun(withT([[5, 0, 1], [5, 1, 1]])), 'word_shape');
assert.equal(A.checkRun({ ...mkRun(rushT, 3), maxCombo: 2 }), 'max_combo');
assert.equal(A.checkRun({ ...mkRun(rushT, 3), maxCombo: 4 }), 'max_combo');
ok('combo_seq / word_shape / max_combo');
// 6
for (const bad of [[0, 1, 0], [81, 1, 0], [5, 1, 2], [1.5, 1, 0]]) assert.equal(A.checkRun(withT([bad])), 'word_shape', JSON.stringify(bad));
ok('word_shape');
// 7
{
  const r = mkRun(rushT, 3);
  const floor = A.minDurationMs('stroke', r);
  assert.equal(floor, A.SCORING.countdownMs + 26 * 150);
  assert.equal(A.checkRun({ ...r, durationMs: Math.ceil(floor * 0.8) }), null);
  assert.equal(A.checkRun({ ...r, durationMs: Math.floor(floor * 0.8) - 1 }), 'too_fast');
  assert.equal(A.minDurationMs('quiz', { asked: 5 }), 2100 + 5000);
  ok('duration floor');
}
// 8
assert.equal(A.parseBoardKey('stroke:4:rush'), null);
assert.ok(A.parseBoardKey('quiz:6:rush'));
assert.ok(A.parseBoardKey('stroke:3:zen'));
ok('board keys');
// 9
{
  // combo may stay at 1 (reset between words), so long runs are easy to build
  const t = (n) => Array.from({ length: n }, () => [1, 1, 0]);
  const dur = { durationMs: 10_000_000 };
  assert.equal(A.checkRun({ ...mkRun(t(997), 3), ...dur }), null); // asked 1000 = cap
  assert.equal(A.checkRun({ ...mkRun(t(998), 3), ...dur }), 'asked_range'); // 1001
  assert.equal(A.checkRun({ ...mkRun(t(297), 3), ...dur }, false), null); // 300
  assert.equal(A.checkRun({ ...mkRun(t(298), 3), ...dur }, false), 'asked_range'); // 301
  assert.equal(A.checkRun({ ...mkRun(rushT, 3), continues: 1 }), 'continues_scope');
  ok('asked caps, continues_scope');
}
// 10
{
  assert.equal(A.strokeWordPoints(10, 1, 1), 1210);
  assert.equal(A.strokeWordPoints(10, 20, 1), 4200);
  for (let s = 1; s <= 80; s++)
    for (let c = 1; c <= 25; c++)
      for (const p of [0, 1]) {
        const x = (70 * s * (1 + Math.min(c, 20) * 0.15) * (p ? 1.5 : 1)) / 10;
        if (Math.abs((x % 1) - 0.5) < 1e-6) continue; // exact .5 ties: float math drifts, the integer form rounds up
        const f = Math.round(x) * 10;
        assert.equal(A.strokeWordPoints(s, c, p), f, `s=${s} c=${c} p=${p}`);
      }
  ok('strokeWordPoints golden + grid');
}
// 11
{
  const base = { clientRunId: 'a'.repeat(16), ticket: null, board: 'stroke:1:rush', score: 0, correct: 0, asked: 0, maxCombo: 0, durationMs: 0, playedAt: 0, scoring: 1 };
  const code = (x) => {
    try {
      V.validateSubmit(x);
    } catch (e) {
      return e.code ?? e.message ?? String(e);
    }
    return 'ok';
  };
  assert.equal(code({ ...base, strokeWords: [[5, 1, 1]] }), 'ok');
  assert.notEqual(code({ ...base, strokeWords: 'x' }), 'ok');
  assert.notEqual(code({ ...base, strokeWords: Array.from({ length: 1001 }, () => [1, 1, 0]) }), 'ok');
  assert.notEqual(code({ ...base, strokeWords: [[1, 1]] }), 'ok');
  assert.notEqual(code({ ...base, strokeWords: [[1, 1, NaN]] }), 'ok');
  ok('validateSubmit strokeWords');
}
