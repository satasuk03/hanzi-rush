// Proves the Jade wallet invariants against a real (local, throwaway) D1: `npm run test:wallet`.
//  - a replayed ref does not double-grant
//  - concurrent spends cannot overdraw
//  - the daily claim pays once per Bangkok day, streak 10/10/15/15/20/20/50, and breaks after a missed day
import { build } from 'esbuild';
import { getPlatformProxy } from 'wrangler';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const tmp = mkdtempSync(join(tmpdir(), 'hr-wallet-'));
const out = join(tmp, 'wallet.mjs');
await build({ entryPoints: ['server/wallet.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const W = await import(pathToFileURL(out).href);

const { env, dispose } = await getPlatformProxy({ persist: { path: join(tmp, 'state') } });
const db = env.DB;
try {
  for (const f of readdirSync('migrations').sort()) {
    const sql = readFileSync(join('migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt.replace(/\s+/g, ' ')).run();
  }
  let n = 0;
  const player = async () => {
    const id = `p${++n}`;
    await db.prepare('INSERT INTO players (id, tag, created_at, last_seen_at) VALUES (?1, ?2, 0, 0)').bind(id, `T${n}`).run();
    return id;
  };
  const jadeOf = async (id) => (await db.prepare('SELECT jade FROM players WHERE id = ?1').bind(id).first()).jade;
  const ledgerSum = async (id) => (await db.prepare('SELECT COALESCE(SUM(delta), 0) AS s FROM jade_ledger WHERE player_id = ?1').bind(id).first()).s;
  const noDrift = async (id) => assert.equal(await jadeOf(id), await ledgerSum(id), 'players.jade must equal the ledger sum');
  const ok = (name) => console.log('ok  ' + name);

  // ---- starter + replay
  {
    const id = await player();
    const a = await W.claimStarter(db, id);
    assert.deepEqual([a.granted, a.replay, a.jade], [100, false, 100]);
    const b = await W.claimStarter(db, id);
    assert.deepEqual([b.granted, b.replay, b.jade], [100, true, 100]);
    await Promise.all([W.claimStarter(db, id), W.claimStarter(db, id), W.claimStarter(db, id)]);
    assert.equal(await jadeOf(id), 100);
    assert.equal((await W.walletState(db, id)).starterClaimed, true);
    await noDrift(id);
    ok('starter pays once; replayed and concurrent refs do not double-grant');
  }

  // ---- replayed ref on a generic grant / spend
  {
    const id = await player();
    await W.applyJade(db, id, 500, 'admin', 'seed');
    const s1 = await W.spendJade(db, id, 100, 'pull', 'ref-1');
    const s2 = await W.spendJade(db, id, 100, 'pull', 'ref-1');
    assert.deepEqual([s1.status, s2.status, s2.delta], ['applied', 'replay', -100]);
    assert.equal(await jadeOf(id), 400);
    await noDrift(id);
    ok('a replayed spend ref is not charged twice');
  }

  // ---- no overdraw, serial and concurrent
  {
    const id = await player();
    await W.applyJade(db, id, 100, 'admin', 'seed');
    const r = await W.spendJade(db, id, 101, 'pull', 'too-much');
    assert.deepEqual([r.status, r.jade], ['insufficient', 100]);
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => W.spendJade(db, id, 30, 'pull', `c${i}`)));
    const applied = res.filter((x) => x.status === 'applied').length;
    assert.equal(applied, 3, 'only 3 x 30 fit in 100');
    assert.equal(res.filter((x) => x.status === 'insufficient').length, 7);
    assert.equal(await jadeOf(id), 10);
    await noDrift(id);
    // the CHECK constraint is the last line of defence even for a buggy writer
    await assert.rejects(() => db.prepare('UPDATE players SET jade = jade - 11 WHERE id = ?1').bind(id).run());
    // concurrent spends racing with the SAME ref charge once
    const id2 = await player();
    await W.applyJade(db, id2, 1000, 'admin', 'seed');
    await Promise.all(Array.from({ length: 5 }, () => W.spendJade(db, id2, 100, 'pull', 'same')));
    assert.equal(await jadeOf(id2), 900);
    ok('concurrent spends cannot overdraw (3 of 10 succeed, balance 10); same-ref race charges once');
  }

  // ---- daily
  {
    const id = await player();
    const D = (s) => Date.parse(s + 'T05:00:00Z'); // 12:00 Bangkok
    const claim = (s, day) => W.claimDaily(db, id, day, D(s));
    const want = [10, 10, 15, 15, 20, 20, 50, 10];
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
    let total = 0;
    for (let i = 0; i < days.length; i++) {
      const r = await claim(days[i]);
      assert.deepEqual([r.granted, r.replay, r.streak], [want[i], false, i + 1], days[i]);
      total += want[i];
      // same day again, serially and concurrently: pays nothing
      const dup = await Promise.all([claim(days[i]), claim(days[i]), claim(days[i])]);
      for (const d of dup) assert.deepEqual([d.replay, d.streak, d.jade], [true, i + 1, total]);
    }
    assert.equal(await jadeOf(id), total);
    // racing first claims of a fresh day: exactly one pays
    const racers = await Promise.all(Array.from({ length: 6 }, () => claim('2026-10-09')));
    assert.equal(racers.filter((r) => !r.replay).length, 1);
    assert.equal(await jadeOf(id), total + 10);
    // missed a day: streak restarts at 10
    const back = await claim('2026-10-11');
    assert.deepEqual([back.granted, back.streak], [10, 1]);
    // Bangkok day boundary: 16:59 UTC and 17:00 UTC are different Bangkok days
    const id3 = await player();
    const a = await W.claimDaily(db, id3, undefined, Date.parse('2026-10-01T16:59:00Z'));
    const same = await W.claimDaily(db, id3, undefined, Date.parse('2026-10-01T16:59:30Z'));
    const next = await W.claimDaily(db, id3, undefined, Date.parse('2026-10-01T17:00:00Z'));
    assert.deepEqual([a.day, a.replay, same.replay, next.day, next.replay, next.streak], ['2026-10-01', false, true, '2026-10-02', false, 2]);
    const next2 = await W.claimDaily(db, id3, undefined, Date.parse('2026-10-02T17:00:00Z'));
    assert.deepEqual([next2.day, next2.replay, next2.streak, next2.granted], ['2026-10-03', false, 3, 15]);
    // a claim queued offline yesterday still counts for yesterday; a bogus day counts as today
    const id4 = await player();
    const q = await W.claimDaily(db, id4, '2026-10-05', D('2026-10-06'));
    assert.deepEqual([q.day, q.replay], ['2026-10-05', false]);
    const q2 = await W.claimDaily(db, id4, '2026-10-06', D('2026-10-06'));
    assert.deepEqual([q2.day, q2.streak], ['2026-10-06', 2]);
    const q3 = await W.claimDaily(db, id4, '1999-01-01', D('2026-10-06'));
    assert.equal(q3.replay, true);
    for (const p of [id, id3, id4]) await noDrift(p);
    ok('daily pays once per Bangkok day, 10/10/15/15/20/20/50 then loops, breaks after a missed day, races pay once');
  }

  // ---- wallet state
  {
    const id = await player();
    await db.prepare("INSERT INTO inventory (player_id, item_id, copies, first_at) VALUES (?1, 'av-fox', 2, 0)").bind(id).run();
    const w = await W.walletState(db, id, Date.parse('2026-10-07T00:00:00Z'));
    assert.deepEqual([w.jade, w.starterClaimed, w.daily.claimable, w.daily.slot, w.inventory], [0, false, true, 0, { 'av-fox': 2 }]);
    ok('wallet state');
  }
  console.log('all wallet checks passed');
} finally {
  await dispose();
  rmSync(tmp, { recursive: true, force: true });
}
