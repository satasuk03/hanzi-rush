// Player-card snapshot: save document -> players.card numbers. `node scripts/test-card.mjs`
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const tmp = mkdtempSync(join(tmpdir(), 'hr-card-'));
const out = join(tmp, 'card.mjs');
await build({ entryPoints: ['server/card.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { buildCard, parseCard } = await import(pathToFileURL(out).href);

const doc = (p = {}) => ({
  v: 1,
  settings: { lang: 'en', sound: true, pinyin: true, voice: true },
  progress: {
    best: {}, words: {}, coins: 0, xp: 0, cards: {}, pity: 0,
    stats: { games: 0, questions: 0, correct: 0, bestCombo: 0, perfect: 0, pulls: 0, coinsEarned: 0, coinsSpent: 0, maxCoins: 0, byRarity: [0, 0, 0, 0, 0] },
    profile: { name: '', title: 'novice', seen: ['novice'] },
    daily: { last: '', streak: 0, best: 0, total: 0 },
    ...p,
  },
});
const ok = (name) => console.log('ok  ' + name);

assert.deepEqual(buildCard(doc()), { level: 1, words: 0, games: 0, correct: 0, questions: 0, bestCombo: 0, bestStreak: 0, titles: 1 });
ok('fresh save');

const c = buildCard(doc({
  xp: 500,
  cards: { '1:a': [1, 0, 0], '1:b': [2, 1, 0], '2:c': [1, 0, 0] },
  stats: { games: 12, questions: 100, correct: 80, bestCombo: 17, perfect: 1, pulls: 3, coinsEarned: 0, coinsSpent: 0, maxCoins: 0, byRarity: [0, 0, 0, 0, 0] },
  profile: { name: 'x', title: 'novice', seen: ['novice', 'novice', 'not-a-title'] },
  daily: { last: '', streak: 2, best: 9, total: 20 },
}));
assert.ok(c.level > 1);
assert.equal(c.words, 3);
assert.equal(c.games, 12);
assert.equal(c.correct, 80);
assert.equal(c.questions, 100);
assert.equal(c.bestCombo, 17);
assert.equal(c.bestStreak, 9);
// the shared evaluator: novice, inkling (level 3), sharp (1 perfect), combo15 (17), streak3 + streak7 (best 9); `seen` is ignored
  assert.equal(c.titles, 6, 'titles unlocked per the shared evaluator, not profile.seen');
ok('stats come from the save');

assert.deepEqual(parseCard(JSON.stringify(c)), c);
assert.equal(parseCard(null), null);
assert.equal(parseCard('{nope'), null);
assert.equal(parseCard('{}'), null);
ok('parseCard');
