// Title Jade rewards (server/titles.ts) + the shared evaluator against a real (local, throwaway) D1: `npm run test:titles`.
//  - evaluator parity for every requirement kind (save + inventory -> unlocked set)
//  - first claim: small sum pays in full, big sum writes markers + a 100 lump; later unlocks pay in full; re-claims pay 0
//  - tier 0 never pays, unmet titles never pay, concurrent claims pay once, rate limit, no save, balance == ledger
import { build } from 'esbuild';
import { getPlatformProxy } from 'wrangler';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const tmp = mkdtempSync(join(tmpdir(), 'hr-titles-'));
await build({
  entryPoints: { titles: 'server/titles.ts', facts: 'server/titleFacts.ts', shared: 'shared/titles.ts', wallet: 'server/wallet.ts', cosmetics: 'shared/cosmetics.ts', card: 'server/card.ts' },
  bundle: true, format: 'esm', platform: 'node', outdir: tmp, outExtension: { '.js': '.mjs' }, logLevel: 'error',
});
const imp = (n) => import(pathToFileURL(join(tmp, `${n}.mjs`)).href);
const T = await imp('titles');
const F = await imp('facts');
const S = await imp('shared');
const W = await imp('wallet');
const C = await imp('cosmetics');
const K = await imp('card');

const ok = (name) => console.log('ok  ' + name);
const codeOf = async (p) => { try { await p; } catch (e) { return e.code; } return null; };

// ---- fixtures
const save = (p = {}) => ({
  v: 1,
  settings: { lang: 'en', sound: true, pinyin: true, voice: true },
  progress: {
    best: {}, words: {}, coins: 0, xp: 0, cards: {}, pity: 0,
    stats: { games: 0, questions: 0, correct: 0, bestCombo: 0, perfect: 0, pulls: 0, coinsEarned: 0, coinsSpent: 0, maxCoins: 0, byRarity: [0, 0, 0, 0, 0] },
    profile: { name: '', title: 'novice', seen: [] },
    daily: { last: '', streak: 0, best: 0, total: 0 },
    ...p,
  },
});
const cardsOf = (lv, n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${lv}:w${i}`, [1, 0, 0]]));
const unlocked = (doc, inv = new Map()) => {
  const f = F.factsFromSave(doc, inv);
  return new Set(S.TITLE_DEFS.filter((d) => S.titleUnlocked(d, f)).map((d) => d.id));
};
const gacha = C.ITEMS.filter((i) => i.source === 'gacha' || !i.source);

// ---- evaluator
{
  assert.equal(S.HSK_WORD_COUNTS.length, 6);
  assert.equal(S.HSK_WORD_COUNTS.reduce((a, b) => a + b, 0), 4991);
  // must match the client data table
  const src = readFileSync('src/core/data.ts', 'utf8');
  const counts = [...src.matchAll(/\{ n: \d, count: (\d+),/g)].map((m) => +m[1]);
  assert.deepEqual(counts, [...S.HSK_WORD_COUNTS], 'HSK_WORD_COUNTS must equal src/core/data.ts LEVELS');
  assert.deepEqual([...S.TITLE_REWARD], [0, 5, 10, 20, 40]);
  ok('HSK_WORD_COUNTS matches LEVELS; reward table');

  let u = unlocked(save());
  assert.deepEqual([...u], ['novice'], 'fresh save holds only novice');

  // level: xp for level 5 and 3
  const xpFor = (L) => { let x = 0; for (let l = 1; l < L; l++) x += Math.round(60 * l ** 1.35 + 40); return x; };
  u = unlocked(save({ xp: xpFor(5) }));
  assert.ok(u.has('scholar') && u.has('inkling') && !u.has('brush'));
  u = unlocked(save({ xp: xpFor(5) - 1 }));
  assert.ok(!u.has('scholar'));
  ok('level kind');

  u = unlocked(save({ cards: { ...cardsOf(1, 150) } }));
  assert.ok(u.has('hsk1') && u.has('collector') && u.has('bookworm') && !u.has('archivist') && !u.has('hsk2'));
  u = unlocked(save({ cards: { ...cardsOf(1, 149) } }));
  assert.ok(!u.has('hsk1') && u.has('collector'));
  const all = {};
  S.HSK_WORD_COUNTS.forEach((n, i) => Object.assign(all, cardsOf(i + 1, n)));
  u = unlocked(save({ cards: all }));
  for (const id of ['hsk1', 'hsk6', 'grandarchive', 'erudite']) assert.ok(u.has(id), id);
  delete all['6:w0'];
  assert.ok(!unlocked(save({ cards: all })).has('grandarchive'));
  ok('owned / hsk / all kinds');

  u = unlocked(save({ daily: { last: '', streak: 1, best: 7, total: 9 } }));
  assert.ok(u.has('streak3') && u.has('streak7') && !u.has('streak14'));
  ok('streak kind (daily.best)');

  const words = {};
  for (let i = 0; i < 50; i++) words[`1:m${i}`] = [5, 4]; // exactly 80%
  words['1:x'] = [5, 3];
  words['1:y'] = [4, 4];
  u = unlocked(save({ words }));
  assert.ok(u.has('fluent'), '50 words at seen>=5, 80%');
  words['1:m0'] = [5, 3];
  assert.ok(!unlocked(save({ words })).has('fluent'), '49 mastered');
  ok('mastered kind');

  u = unlocked(save({ stats: { ...save().progress.stats, games: 50, questions: 300, correct: 100, bestCombo: 30, perfect: 10, pulls: 200, maxCoins: 5000, byRarity: [0, 0, 0, 3, 2] } }));
  for (const id of ['regular', 'neverdie', 'warmup', 'combo15', 'combo', 'sharp', 'perfect10', 'lucky', 'whale', 'wealth', 'golden']) assert.ok(u.has(id), id);
  for (const id of ['veteran', 'mythichunter', 'flawless', 'rich', 'forged']) assert.ok(!u.has(id), id);
  u = unlocked(save({ stats: { ...save().progress.stats, byRarity: [0, 0, 0, 0, 3] } }));
  assert.ok(u.has('chosen') && u.has('mythichunter') && !u.has('golden'), 'mythic 3 -> chosen, hunter; legendary = r3 + r4 = 3 < 5');
  ok('stat kinds (wrong = questions - correct, legendary = r3+r4, mythic = r4)');

  const inv25 = new Map(gacha.slice(0, 25).map((i) => [i.id, 1]));
  assert.ok(unlocked(save(), inv25).has('wardrobe'));
  inv25.set(gacha[0].id, 0);
  assert.ok(!unlocked(save(), inv25).has('wardrobe'), 'copies 0 does not count');
  assert.ok(!unlocked(save(), new Map(gacha.slice(0, 24).map((i) => [i.id, 1]))).has('wardrobe'));
  const withUnknown = new Map(gacha.slice(0, 24).map((i) => [i.id, 1]));
  withUnknown.set('not_an_item', 3);
  assert.ok(!unlocked(save(), withUnknown).has('wardrobe'), 'unknown ids do not count');
  const set0 = new Map(C.SETS[0].items.map((id) => [id, 1]));
  assert.ok(unlocked(save(), set0).has('fullset'));
  set0.delete(C.SETS[0].items[0]);
  assert.ok(!unlocked(save(), set0).has('fullset'));
  ok('cosmetics / sets kinds from the inventory');

  // titleCount caps have at need
  const f = F.factsFromSave(save({ xp: xpFor(40) }), new Map());
  assert.deepEqual(S.titleCount({ k: 'level', n: 5 }, f), { have: 5, need: 5 });
  // garbage in a stored save does not throw
  assert.doesNotThrow(() => unlocked({ progress: { cards: null, words: null, stats: {}, daily: null } }));
  ok('titleCount caps; malformed save tolerated');
}

// ---- card count uses the evaluator
{
  assert.equal(K.buildCard(save()).titles, 1);
  const doc = save({ xp: 500, stats: { ...save().progress.stats, perfect: 1, bestCombo: 17 }, daily: { last: '', streak: 0, best: 9, total: 9 }, profile: { name: '', title: 'novice', seen: ['wardrobe'] } });
  // novice, inkling (level 3), sharp, combo15, streak3, streak7, + wardrobe via seen (no inventory given)
  assert.equal(K.buildCard(doc).titles, 7);
  assert.equal(K.buildCard(doc, new Map()).titles, 6, 'with an inventory, seen is not trusted for cosmetics');
  ok('card titles count');
}

// ---- server claims
const { env, dispose } = await getPlatformProxy({ persist: { path: join(tmp, 'state') } });
const db = env.DB;
try {
  for (const f of readdirSync('migrations').sort()) {
    const sql = readFileSync(join('migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt.replace(/\s+/g, ' ')).run();
  }
  let n = 0;
  const player = async (doc) => {
    const id = `p${++n}`;
    await db.prepare('INSERT INTO players (id, tag, created_at, last_seen_at) VALUES (?1, ?2, 0, 0)').bind(id, `T${n}`).run();
    if (doc) await putSave(id, doc);
    return id;
  };
  const putSave = async (id, doc) => {
    const data = JSON.stringify(doc);
    await db.prepare("INSERT INTO saves (player_id, revision, format, data, bytes, updated_at) VALUES (?1, 1, 1, ?2, ?3, 0) ON CONFLICT (player_id) DO UPDATE SET data = ?2, revision = revision + 1").bind(id, data, data.length).run();
  };
  const jadeOf = async (id) => (await db.prepare('SELECT jade FROM players WHERE id = ?1').bind(id).first()).jade;
  const ledger = async (id) => (await db.prepare("SELECT ref, delta FROM jade_ledger WHERE player_id = ?1 AND reason = 'title' ORDER BY ref").bind(id).all()).results;
  const noDrift = async (id) => {
    const s = (await db.prepare('SELECT COALESCE(SUM(delta), 0) AS s FROM jade_ledger WHERE player_id = ?1').bind(id).first()).s;
    assert.equal(await jadeOf(id), s, 'players.jade must equal the ledger sum');
  };
  const xpFor = (L) => { let x = 0; for (let l = 1; l < L; l++) x += Math.round(60 * l ** 1.35 + 40); return x; };
  const t0 = 1_000_000;

  // small first claim pays in full; re-claim pays 0
  {
    // scholar (tier 1 = 5) + inkling (tier 0) + sharp (tier 1 = 5): sum 10
    const id = await player(save({ xp: xpFor(5), stats: { ...save().progress.stats, perfect: 1 } }));
    const a = await T.claimTitles(db, id, t0);
    assert.deepEqual(a.paid.map((p) => [p.id, p.jade]).sort(), [['scholar', 5], ['sharp', 5]]);
    assert.equal(a.retro, 0);
    assert.equal(a.jade, 10);
    assert.deepEqual((await ledger(id)).map((r) => r.ref), ['scholar', 'sharp'], 'tier 0 titles write nothing');
    const b = await T.claimTitles(db, id, t0 + 20_000);
    assert.deepEqual([b.paid.length, b.retro, b.jade], [0, 0, 10]);
    assert.equal(await jadeOf(id), 10);
    await noDrift(id);
    ok('first claim under the cap pays in full; re-claim pays 0; tier 0 never written');
  }

  // big first claim: markers + 100 lump; later unlock pays in full
  {
    const all = {};
    S.HSK_WORD_COUNTS.forEach((c, i) => Object.assign(all, cardsOf(i + 1, c)));
    const doc = save({ xp: xpFor(50), cards: all });
    const sumDue = S.TITLE_DEFS.filter((d) => d.tier > 0 && unlocked(doc).has(d.id)).reduce((s, d) => s + S.TITLE_REWARD[d.tier], 0);
    assert.ok(sumDue > 100);
    const id = await player(doc);
    const a = await T.claimTitles(db, id, t0);
    assert.equal(a.retro, 100);
    assert.equal(a.jade, 100);
    assert.ok(a.paid.length > 5 && a.paid.every((p) => p.jade === 0), 'markers listed with jade 0');
    const rows = await ledger(id);
    assert.equal(rows.find((r) => r.ref === 'retro').delta, 100);
    assert.equal(rows.filter((r) => r.ref !== 'retro').length, a.paid.length);
    assert.ok(rows.every((r) => r.ref === 'retro' || r.delta === 0));
    assert.equal(await jadeOf(id), 100);
    const w = await W.walletState(db, id, t0);
    assert.ok(!w.titlesPaid.includes('retro'));
    assert.deepEqual([...w.titlesPaid].sort(), a.paid.map((p) => p.id).sort());
    // re-claim: nothing
    const b = await T.claimTitles(db, id, t0 + 20_000);
    assert.deepEqual([b.paid.length, b.retro, b.jade], [0, 0, 100]);
    // a later unlock pays in full (streak30 = tier 3 = 20)
    doc.progress.daily.best = 30;
    await putSave(id, doc);
    const c = await T.claimTitles(db, id, t0 + 40_000);
    const got = Object.fromEntries(c.paid.map((p) => [p.id, p.jade]));
    assert.deepEqual(got, { streak7: 10, streak14: 10, streak30: 20 });
    assert.equal(c.retro, 0);
    assert.equal(await jadeOf(id), 140);
    await noDrift(id);
    ok('big first claim: markers + retro 100; later unlocks pay in full');
  }

  // unmet titles are not paid; titles earned after an under-cap first claim pay in full
  {
    const id = await player(save());
    const a = await T.claimTitles(db, id, t0);
    assert.deepEqual([a.paid.length, a.retro, a.jade], [0, 0, 0]);
    assert.equal((await ledger(id)).length, 0);
    await putSave(id, save({ xp: xpFor(10) }));
    const b = await T.claimTitles(db, id, t0 + 20_000);
    assert.deepEqual(b.paid.map((p) => [p.id, p.jade]).sort(), [['brush', 10], ['scholar', 5]]);
    await putSave(id, save({ xp: xpFor(15) }));
    const c = await T.claimTitles(db, id, t0 + 40_000);
    assert.deepEqual(c.paid, [{ id: 'adept', jade: 20 }]);
    assert.equal(await jadeOf(id), 35);
    await noDrift(id);
    ok('nothing met = nothing paid; later unlocks pay their tier');
  }

  // inventory-backed titles
  {
    const id = await player(save());
    const items = C.SETS[0].items;
    for (const it of items) await db.prepare('INSERT INTO inventory (player_id, item_id, copies, first_at) VALUES (?1, ?2, 1, 0)').bind(id, it).run();
    const a = await T.claimTitles(db, id, t0);
    assert.deepEqual(a.paid, [{ id: 'fullset', jade: 20 }]);
    await noDrift(id);
    ok('fullset pays from the server inventory');
  }

  // concurrent claims pay once (small and big first claims)
  {
    const id = await player(save({ xp: xpFor(10) }));
    const res = await Promise.all(Array.from({ length: 6 }, () => T.claimTitles(db, id, t0).catch((e) => ({ err: e.code }))));
    const paid = res.filter((r) => r.paid).flatMap((r) => r.paid);
    assert.deepEqual(paid.map((p) => p.id).sort(), ['brush', 'scholar'], 'each title paid exactly once across callers');
    assert.equal(await jadeOf(id), 15);
    await noDrift(id);

    const all = {};
    S.HSK_WORD_COUNTS.forEach((c, i) => Object.assign(all, cardsOf(i + 1, c)));
    const id2 = await player(save({ xp: xpFor(50), cards: all }));
    const r2 = await Promise.all(Array.from({ length: 6 }, () => T.claimTitles(db, id2, t0)));
    assert.equal(r2.filter((r) => r.retro === 100).length, 1, 'exactly one caller got the lump');
    assert.equal(await jadeOf(id2), 100);
    await noDrift(id2);
    ok('concurrent first claims pay once (small and capped)');
  }

  // no save / bad save
  {
    const id = await player();
    assert.deepEqual(await T.claimTitles(db, id, t0), { paid: [], retro: 0, jade: 0 });
    const id2 = await player();
    await db.prepare("INSERT INTO saves (player_id, revision, format, data, bytes, updated_at) VALUES (?1, 1, 1, '{nope', 5, 0)").bind(id2).run();
    assert.deepEqual(await T.claimTitles(db, id2, t0), { paid: [], retro: 0, jade: 0 });
    ok('no save / unparseable save pays nothing');
  }

  // rate limit
  {
    const id = await player(save({ xp: xpFor(5) }));
    await T.claimTitles(db, id, t0);
    assert.equal(await codeOf(T.claimTitles(db, id, t0 + 9_999)), 'rate_limited');
    assert.equal(await codeOf(T.claimTitles(db, id, t0 + 10_000)), null);
    ok('rate limit 10 s');
  }
} finally {
  await dispose();
  rmSync(tmp, { recursive: true, force: true });
}
