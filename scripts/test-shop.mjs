// Proves the box pull invariants (server/shop.ts) against a real (local, throwaway) D1: `npm run test:shop`.
//  - rates, box floors, hard pity per box, the x10 EPIC+ guarantee, the unowned x3 bias, the empty-pool rule
//  - duplicate refunds and the balance arithmetic, replay returns the stored result and charges nothing
//  - an insufficient balance writes nothing; concurrent pulls cannot overdraw or break pity; same-ref races charge once
// Pool sizes come from the catalog (gachaPool), never hard-coded: frames, name effects and badges land later.
import { build } from 'esbuild';
import { getPlatformProxy } from 'wrangler';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const tmp = mkdtempSync(join(tmpdir(), 'hr-shop-'));
await build({
  entryPoints: { shop: 'server/shop.ts', wallet: 'server/wallet.ts', cosmetics: 'shared/cosmetics.ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outdir: tmp,
  outExtension: { '.js': '.mjs' },
  logLevel: 'error',
});
// one bundle carries both shop and its ApiError; cosmetics is pure data, a separate copy is fine
const S = await import(pathToFileURL(join(tmp, 'shop.mjs')).href);
const W = await import(pathToFileURL(join(tmp, 'wallet.mjs')).href);
const C = await import(pathToFileURL(join(tmp, 'cosmetics.mjs')).href);

/** seeded uniform [0, 1) */
const mulberry = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** the given values, then 0 forever (0 = the lowest allowed rarity and the first item of the pool) */
const script = (vals) => {
  let i = 0;
  return () => (i < vals.length ? vals[i++] : 0);
};
const zero = () => 0;
const box = (id) => C.boxById(id);
const FAST = { minIntervalMs: 0 };
const codeOf = async (p) => {
  try {
    await p;
  } catch (e) {
    return e.code ?? String(e);
  }
  return 'ok';
};

const { env, dispose } = await getPlatformProxy({ persist: { path: join(tmp, 'state') } });
const db = env.DB;
let refN = 0;
const newRef = () => `ref-${String(++refN).padStart(6, '0')}`;
try {
  for (const f of readdirSync('migrations').sort()) {
    const sql = readFileSync(join('migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt.replace(/\s+/g, ' ')).run();
  }
  let n = 0;
  const player = async (jade = 0) => {
    const id = `p${++n}`;
    await db.prepare('INSERT INTO players (id, tag, created_at, last_seen_at) VALUES (?1, ?2, 0, 0)').bind(id, `T${n}`).run();
    if (jade) await W.applyJade(db, id, jade, 'admin', 'seed');
    return id;
  };
  const one = async (sql, ...args) => await db.prepare(sql).bind(...args).first();
  const count = async (table, id, extra = '') => (await one(`SELECT COUNT(*) AS c FROM ${table} WHERE player_id = ?1 ${extra}`, id)).c;
  const jadeOf = async (id) => (await one('SELECT jade FROM players WHERE id = ?1', id)).jade;
  const ledgerSum = async (id) => (await one('SELECT COALESCE(SUM(delta), 0) AS s FROM jade_ledger WHERE player_id = ?1', id)).s;
  const noDrift = async (id) => assert.equal(await jadeOf(id), await ledgerSum(id), 'players.jade must equal the ledger sum');
  const invOf = async (id) => Object.fromEntries((await db.prepare('SELECT item_id, copies FROM inventory WHERE player_id = ?1').bind(id).all()).results.map((r) => [r.item_id, r.copies]));
  const pityOf = async (id, b) => (await one('SELECT pulls_since FROM banner_pity WHERE player_id = ?1 AND banner_id = ?2', id, b))?.pulls_since ?? 0;
  const ok = (name) => console.log('ok  ' + name);
  const pools = [0, 1, 2, 3, 4].map((r) => C.gachaPool(r));
  console.log(`gacha pool sizes by rarity: ${pools.map((p) => p.length).join(' / ')}`);

  // ---- rates (pure roll, many seeded boxes, pity kept out of the way)
  {
    const rng = mulberry(1);
    const N = 200_000;
    for (const b of C.BOXES) {
      const seen = [0, 0, 0, 0, 0];
      for (let i = 0; i < N; i++) seen[S.rollPull(b, 1, 0, new Map(), rng).drops[0].rarity]++;
      for (let r = 0; r < 5; r++) {
        if (!pools[r].length) continue; // empty-pool rule moves this rarity's share (tested below)
        const got = (seen[r] / N) * 100;
        assert.ok(Math.abs(got - b.rates[r]) < 0.5, `${b.id} rarity ${r}: ${got.toFixed(2)}% vs ${b.rates[r]}%`);
      }
    }
    // the same through D1, end to end (pity included, so loose bounds)
    const id = await player(100 * 300);
    const seen = [0, 0, 0, 0, 0];
    const rng2 = mulberry(2);
    for (let i = 0; i < 300; i++) for (const d of (await S.pull(db, id, 'standard', 1, newRef(), rng2, FAST)).drops) seen[d.rarity]++;
    assert.ok(seen[0] > 130 && seen[0] < 200, `D1 standard COMMON ${seen[0]}/300`);
    assert.ok(seen[3] + seen[4] >= 10, `D1 standard LEGENDARY+ ${seen[3] + seen[4]}/300 (pity alone gives 10)`);
    await noDrift(id);
    ok(`rates match BOXES within 0.5 pt over ${N} rolls per box; 300 D1 pulls look right (${seen.join('/')})`);
  }

  // ---- box floors
  {
    const rng = mulberry(3);
    for (let i = 0; i < 20_000; i++) {
      for (const d of S.rollPull(box('select'), 10, i % 12, new Map(), rng).drops) assert.ok(d.rarity >= 1, 'Select never COMMON');
      for (const d of S.rollPull(box('supreme'), 10, i % 5, new Map(), rng).drops) assert.ok(d.rarity >= 2, 'Supreme never below EPIC');
    }
    const id = await player(250 * 9 * 3 + 600 * 9 * 3);
    for (let i = 0; i < 3; i++) {
      for (const d of (await S.pull(db, id, 'select', 10, newRef(), rng, FAST)).drops) assert.ok(d.rarity >= 1);
      for (const d of (await S.pull(db, id, 'supreme', 10, newRef(), rng, FAST)).drops) assert.ok(d.rarity >= 2);
    }
    ok('Select never drops COMMON, Supreme never below EPIC (pure and through D1)');
  }

  // ---- hard pity per box: fires exactly at the limit, resets, counters are separate
  {
    const id = await player(100 * 61 + 250 * 25 + 600 * 11);
    for (const [bid, extra] of [['standard', 1], ['select', 1], ['supreme', 1]]) {
      const b = box(bid);
      for (let k = 1; k <= 2 * b.pity + extra; k++) {
        const r = await S.pull(db, id, bid, 1, newRef(), zero, FAST);
        const hit = k % b.pity === 0;
        assert.equal(r.drops[0].rarity >= C.PITY_RARITY, hit, `${bid} box ${k}: ${hit ? 'pity must fire' : 'no LEGENDARY with rng 0'}`);
        assert.equal(r.pity[bid], k % b.pity, `${bid} pity after box ${k}`);
        assert.equal(await pityOf(id, bid), k % b.pity);
      }
    }
    // the three counters never touched each other
    assert.deepEqual([await pityOf(id, 'standard'), await pityOf(id, 'select'), await pityOf(id, 'supreme')], [1, 1, 1]);
    await noDrift(id);

    // a natural LEGENDARY+ resets the counter too
    const id2 = await player(1000);
    for (let k = 0; k < 3; k++) await S.pull(db, id2, 'standard', 1, newRef(), zero, FAST);
    assert.equal(await pityOf(id2, 'standard'), 3);
    const nat = await S.pull(db, id2, 'standard', 1, newRef(), script([0.999]), FAST); // 99.9 of 100 → MYTHIC
    assert.deepEqual([nat.drops[0].rarity, nat.pity.standard, await pityOf(id2, 'standard')], [4, 0, 0]);
    // a forced roll keeps the box's odds above the floor: Standard pity is LEGENDARY 4 : MYTHIC 1
    const forced = [0, 0];
    const rng = mulberry(4);
    for (let i = 0; i < 50_000; i++) forced[S.rollPull(box('standard'), 1, 29, new Map(), rng).drops[0].rarity - 3]++;
    assert.ok(Math.abs(forced[1] / 50_000 - 0.2) < 0.01, `forced MYTHIC share ${forced[1] / 50_000}`);
    ok('pity fires exactly at box 30 / 12 / 5, resets on forced and natural LEGENDARY+, separate per box');
  }

  // ---- x10 guarantee
  {
    const id = await player(900 * 3);
    // rng 0: nine floor rolls, the last is forced EPIC
    const a = await S.pull(db, id, 'standard', 10, newRef(), zero, FAST);
    assert.deepEqual(a.drops.map((d) => d.rarity), [0, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
    assert.equal(a.pity.standard, 10);
    // an EPIC earlier in the batch means no forcing
    const b = await S.pull(db, id, 'standard', 10, newRef(), script([0.9]), FAST); // 90 of 100 → EPIC
    assert.deepEqual(b.drops.map((d) => d.rarity), [2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // the third x10 crosses box 30: the pity floor (LEGENDARY) beats the x10 floor (EPIC)
    const c = await S.pull(db, id, 'standard', 10, newRef(), zero, FAST);
    assert.deepEqual([c.drops[9].rarity, c.pity.standard], [3, 0]);
    // pure: every x10 of every box has an EPIC+
    const rng = mulberry(5);
    for (const bx of C.BOXES) for (let i = 0; i < 20_000; i++) assert.ok(S.rollPull(bx, 10, 0, new Map(), rng).drops.some((d) => d.rarity >= 2));
    ok('x10 guarantees EPIC+ on the last roll only when needed; pity wins when both fire');
  }

  // ---- unowned x3 bias (pure; uses whatever COMMON items exist)
  {
    const commons = pools[0];
    assert.ok(commons.length >= 2, 'need two COMMON gacha items');
    const owned = new Map(commons.slice(0, Math.floor(commons.length / 2)).map((i) => [i.id, 1]));
    const flat = { ...box('standard'), rates: [100, 0, 0, 0, 0], pity: 1e9 };
    const hits = new Map();
    const rng = mulberry(6);
    const N = 300_000;
    for (let i = 0; i < N; i++) {
      const id = S.rollPull(flat, 1, 0, owned, rng).drops[0].itemId;
      hits.set(id, (hits.get(id) ?? 0) + 1);
    }
    const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const own = avg(commons.filter((i) => owned.has(i.id)).map((i) => hits.get(i.id) ?? 0));
    const fresh = avg(commons.filter((i) => !owned.has(i.id)).map((i) => hits.get(i.id) ?? 0));
    assert.ok(Math.abs(fresh / own - 3) < 0.1, `unowned/owned ratio ${(fresh / own).toFixed(3)}`);
    // earlier drops of the same batch count as owned: a x10 over a 2-item pool is new, new, then duplicates
    const two = (r) => (r === 0 ? commons.slice(0, 2) : []);
    // rolls: rarity, item, rarity, item (weights 1 : 3 after the first drop, so 0.5 lands on the second item)
    const d = S.rollPull(flat, 10, 0, new Map(), script([0, 0, 0, 0.5]), two).drops;
    assert.deepEqual(d.slice(0, 2).map((x) => [x.itemId, x.isNew]), [[commons[0].id, true], [commons[1].id, true]]);
    ok(`unowned items drop ${(fresh / own).toFixed(2)}x as often as owned ones; same-batch drops count as owned`);
  }

  // ---- empty-pool rule
  {
    const without = (...empty) => (r) => (empty.includes(r) ? [] : pools[r]);
    // rolled EPIC on Standard with no EPIC items: goes UP to LEGENDARY (never worse than the roll)
    const up = S.rollPull(box('standard'), 1, 0, new Map(), script([0.9]), without(2)).drops[0];
    assert.equal(up.rarity, 3);
    // forced pity with no LEGENDARY items: MYTHIC, and the pity resets
    const p = S.rollPull(box('supreme'), 1, 4, new Map(), zero, without(3));
    assert.deepEqual([p.drops[0].rarity, p.pity], [4, 0]);
    // rolled MYTHIC with no MYTHIC items: nearest below (LEGENDARY), not further
    const down = S.rollPull(box('standard'), 1, 0, new Map(), script([0.999]), without(4)).drops[0];
    assert.equal(down.rarity, 3);
    // nothing at or above the pity floor: falls back (never below the box floor) and the pity does NOT reset
    const deg = S.rollPull(box('standard'), 1, 29, new Map(), zero, without(3, 4));
    assert.deepEqual([deg.drops[0].rarity, deg.pity], [2, 30]);
    // a box with nothing at or above its minRarity cannot drop at all
    assert.equal(await codeOf(Promise.resolve().then(() => S.rollPull(box('supreme'), 1, 0, new Map(), zero, without(2, 3, 4)))), 'server_error');
    ok('empty pools resolve upward first, then down to the box floor; pity/x10 guarantees hold');
  }

  // ---- duplicates, refunds and balance arithmetic
  {
    // rng 0 always picks the same COMMON: new, then 8 duplicates within the batch, then the forced EPIC
    const id = await player(1000);
    const r = await S.pull(db, id, 'standard', 10, newRef(), zero, FAST);
    const c0 = pools[0][0].id;
    assert.deepEqual(r.drops.slice(0, 9).map((d) => [d.itemId, d.isNew, d.copies, d.refund]), Array.from({ length: 9 }, (_, i) => [c0, i === 0, i + 1, i === 0 ? 0 : 5]));
    assert.deepEqual([r.drops[9].rarity, r.drops[9].isNew, r.drops[9].refund], [2, true, 0]);
    assert.deepEqual([r.cost, r.refund, r.jade], [900, 40, 140]);
    assert.equal(await jadeOf(id), 140);
    assert.deepEqual(await invOf(id), { [c0]: 9, [r.drops[9].itemId]: 1 });
    const rows = (await db.prepare("SELECT reason, ref, delta, balance_after FROM jade_ledger WHERE player_id = ?1 AND reason != 'admin' ORDER BY id").bind(id).all()).results;
    assert.deepEqual(rows.map((x) => [x.reason, x.delta, x.balance_after]), [['pull', -900, 100], ['dupe_refund', 40, 140]]);
    assert.equal(rows[1].ref, S.refundRef(rows[0].ref));
    await noDrift(id);

    // every rarity refunds DUPLICATE_REFUND[rarity] when everything is already owned
    const id2 = await player(600 * 9 * 2 + 100 * 9 * 4);
    for (const it of C.ITEMS.filter((i) => i.source === 'gacha')) await db.prepare('INSERT INTO inventory (player_id, item_id, copies, first_at) VALUES (?1, ?2, 1, 0)').bind(id2, it.id).run();
    const before = await invOf(id2);
    let start = await jadeOf(id2);
    const seenR = new Set();
    const rng = mulberry(7);
    for (const [bid, k] of [['standard', 4], ['supreme', 2]]) {
      for (let i = 0; i < k; i++) {
        const x = await S.pull(db, id2, bid, 10, newRef(), rng, FAST);
        for (const d of x.drops) {
          assert.deepEqual([d.isNew, d.refund], [false, C.DUPLICATE_REFUND[d.rarity]]);
          seenR.add(d.rarity);
          before[d.itemId]++;
          assert.equal(d.copies, before[d.itemId]);
        }
        assert.equal(x.refund, x.drops.reduce((s, d) => s + d.refund, 0));
        assert.equal(x.jade, start - x.cost + x.refund);
        start = x.jade;
      }
    }
    assert.deepEqual(await invOf(id2), before);
    assert.ok(seenR.has(0) && seenR.has(2), 'saw COMMON and EPIC duplicates');
    await noDrift(id2);
    ok(`duplicates refund 5/10/25/50/100 by item rarity (seen ${[...seenR].sort().join(',')}); balance = start - cost + refunds; ledger has a pull row and one dupe_refund row`);
  }

  // ---- replay
  {
    const id = await player(1000);
    const ref = newRef();
    const now = 1_800_000_000_000;
    const a = await S.pull(db, id, 'standard', 10, ref, mulberry(8), { now });
    const snap = [await jadeOf(id), await invOf(id), await count('jade_ledger', id), await pityOf(id, 'standard')];
    // immediately, with another rng and even another box: the stored result, no charge, not rate limited
    const b = await S.pull(db, id, 'supreme', 1, ref, mulberry(99), { now: now + 10 });
    assert.equal(b.replay, true);
    assert.deepEqual({ ...b, replay: false }, a);
    assert.deepEqual([await jadeOf(id), await invOf(id), await count('jade_ledger', id), await pityOf(id, 'standard')], snap);
    // a new ref inside the interval is rate limited; after it, fine
    assert.equal(await codeOf(S.pull(db, id, 'standard', 1, newRef(), zero, { now: now + 500 })), 'rate_limited');
    assert.equal((await S.pull(db, id, 'standard', 1, newRef(), zero, { now: now + 1000 })).replay, false);
    // a later replay shows the current balance but the original drops
    const c = await S.pull(db, id, 'standard', 10, ref, zero, { now: now + 5000 });
    assert.deepEqual([c.drops, c.jade], [a.drops, await jadeOf(id)]);
    await noDrift(id);
    ok('replayed ref returns the identical stored result, charges nothing and is not rate limited');
  }

  // ---- insufficient balance writes nothing
  {
    const id = await player(99);
    assert.equal(await codeOf(S.pull(db, id, 'standard', 1, newRef(), zero, FAST)), 'insufficient_jade');
    const id2 = await player(899);
    assert.equal(await codeOf(S.pull(db, id2, 'standard', 10, newRef(), zero, FAST)), 'insufficient_jade');
    for (const [p, j] of [[id, 99], [id2, 899]]) {
      assert.deepEqual(
        [await jadeOf(p), await count('jade_ledger', p), await count('inventory', p), await count('banner_pity', p), await count('shop_pulls', p), (await one('SELECT pull_seq FROM players WHERE id = ?1', p)).pull_seq],
        [j, 1, 0, 0, 0, 0],
      );
    }
    ok('insufficient balance: 402, and no ledger, inventory, pity, result or version write');
  }

  // ---- bad input, and a 'pull' ref already spent outside the shop
  {
    const id = await player(1000);
    for (const [b, q, r] of [['gold', 1, newRef()], ['standard', 2, newRef()], ['standard', '1', newRef()], ['standard', 1, 'short'], ['standard', 1, 'has:colon-123'], ['standard', 1, 'x'.repeat(65)], ['standard', 1, 42]]) {
      assert.equal(await codeOf(S.pull(db, id, b, q, r, zero, FAST)), 'bad_request', JSON.stringify([b, q, r]));
    }
    await W.spendJade(db, id, 100, 'pull', 'legacy-ref-1');
    assert.equal(await codeOf(S.pull(db, id, 'standard', 1, 'legacy-ref-1', zero, FAST)), 'bad_request');
    assert.equal(await jadeOf(id), 900);
    ok('unknown box, bad qty and bad refs are 400; a ref already spent elsewhere is never charged again');
  }

  // ---- concurrency: different refs cannot overdraw
  {
    const id = await player(350);
    const out = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => S.pull(db, id, 'standard', 1, newRef(), mulberry(100 + i), FAST)));
    const applied = out.filter((o) => o.status === 'fulfilled').map((o) => o.value);
    const errs = out.filter((o) => o.status === 'rejected').map((o) => o.reason.code);
    assert.ok(errs.every((c) => c === 'insufficient_jade' || c === 'rate_limited'), errs.join(','));
    assert.ok(applied.length >= 1 && applied.length <= 3, `applied ${applied.length}`);
    const refunds = applied.reduce((s, r) => s + r.refund, 0);
    assert.equal(await jadeOf(id), 350 - 100 * applied.length + refunds);
    assert.ok((await jadeOf(id)) >= 0);
    assert.deepEqual(
      [await count('shop_pulls', id), await count('jade_ledger', id, "AND reason = 'pull'"), Object.values(await invOf(id)).reduce((s, x) => s + x, 0), (await one('SELECT pull_seq FROM players WHERE id = ?1', id)).pull_seq],
      [applied.length, applied.length, applied.length, applied.length],
    );
    await noDrift(id);
    ok(`10 concurrent pulls on 350 Jade: ${applied.length} applied, others ${[...new Set(errs)].join('/')}; no overdraw, no partial writes`);
  }

  // ---- concurrency: pity stays exact across racing refs (clients retry their own ref until it lands)
  {
    const id = await player(600 * 12);
    const refs = Array.from({ length: 12 }, newRef);
    const done = new Map();
    let rounds = 0;
    let lost = 0;
    while (done.size < refs.length && rounds++ < 30) {
      const out = await Promise.allSettled(refs.filter((r) => !done.has(r)).map((r) => S.pull(db, id, 'supreme', 1, r, zero, FAST).then((v) => [r, v])));
      for (const o of out) {
        if (o.status === 'fulfilled') done.set(o.value[0], o.value[1]);
        else {
          assert.equal(o.reason.code, 'rate_limited');
          lost++;
        }
      }
    }
    assert.equal(done.size, 12, 'every ref eventually lands');
    const rows = (await db.prepare('SELECT seq, drops, pity FROM shop_pulls WHERE player_id = ?1 ORDER BY seq').bind(id).all()).results;
    assert.deepEqual(rows.map((r) => r.seq), Array.from({ length: 12 }, (_, i) => i + 1), 'one pull per version');
    for (const r of rows) {
      const rarity = JSON.parse(r.drops)[0].rarity;
      assert.equal(rarity >= C.PITY_RARITY, r.seq % 5 === 0, `seq ${r.seq}: LEGENDARY+ exactly every 5th box`);
      assert.equal(JSON.parse(r.pity).supreme, r.seq % 5);
    }
    assert.deepEqual([await pityOf(id, 'supreme'), await jadeOf(id)], [12 % 5, await ledgerSum(id)]);
    assert.equal(Object.values(await invOf(id)).reduce((s, x) => s + x, 0), 12);
    ok(`12 racing Supreme pulls: versions 1..12, pity fires exactly at 5 and 10, final pity 2 (${lost} attempts lost a race and were retried)`);
  }

  // ---- concurrency: the same ref racing charges once
  {
    const id = await player(1000);
    const ref = newRef();
    const out = await Promise.all(Array.from({ length: 6 }, (_, i) => S.pull(db, id, 'standard', 10, ref, mulberry(200 + i), FAST)));
    assert.equal(out.filter((r) => !r.replay).length, 1);
    for (const r of out) assert.deepEqual(r.drops, out[0].drops);
    const first = out.find((r) => !r.replay);
    assert.equal(await jadeOf(id), 1000 - 900 + first.refund);
    assert.deepEqual([await count('shop_pulls', id), await count('jade_ledger', id, "AND reason = 'pull'")], [1, 1]);
    await noDrift(id);
    ok('6 concurrent requests with one ref: charged once, all see the same drops');
  }
  console.log('all shop checks passed');
} finally {
  await dispose();
  rmSync(tmp, { recursive: true, force: true });
}
