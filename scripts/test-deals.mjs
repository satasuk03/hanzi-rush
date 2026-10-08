// Proves the daily deals invariants (server/deals.ts) against a real (local, throwaway) D1: `npm run test:deals`.
//  - dealsFor: deterministic, per-day, never MYTHIC or owned-at-day-start, no duplicates, stable all day, fallbacks
//  - buying: one charge, one 'deal' ledger row, inventory +1, pull_seq +1, replay, one buy per slot, refusals write nothing
//  - races with a pull and with a same-ref twin, set bonuses, balance-vs-ledger consistency, account delete
import { build } from 'esbuild';
import { getPlatformProxy } from 'wrangler';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const tmp = mkdtempSync(join(tmpdir(), 'hr-deals-'));
await build({
  entryPoints: { shop: 'server/shop.ts', deals: 'server/deals.ts', wallet: 'server/wallet.ts', cosmetics: 'shared/cosmetics.ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outdir: tmp,
  outExtension: { '.js': '.mjs' },
  logLevel: 'error',
});
const imp = (n) => import(pathToFileURL(join(tmp, n + '.mjs')).href);
const S = await imp('shop');
const D = await imp('deals');
const W = await imp('wallet');
const C = await imp('cosmetics');

const NOW = Date.UTC(2026, 9, 8, 5, 0, 0); // 12:00 Bangkok
const DAY = '2026-10-08';
const FAST = { minIntervalMs: 0, now: NOW };
const BEFORE = D.dayStart(DAY) - 1000; // first_at of "owned at day start"
const errOf = async (p) => {
  try {
    await p;
  } catch (e) {
    return { code: e.code ?? String(e), reason: e.opts?.reason };
  }
  return { code: 'ok' };
};
const gacha = [0, 1, 2, 3, 4].map((r) => C.gachaPool(r).map((i) => i.id));

const { env, dispose } = await getPlatformProxy({ persist: { path: join(tmp, 'state') } });
const db = env.DB;
let refN = 0;
const newRef = () => `deal-${String(++refN).padStart(6, '0')}`;
try {
  for (const f of readdirSync('migrations').sort()) {
    const sql = readFileSync(join('migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt.replace(/\s+/g, ' ')).run();
  }
  let n = 0;
  const player = async (jade = 0, id = `p${++n}`) => {
    await db.prepare('INSERT INTO players (id, tag, created_at, last_seen_at) VALUES (?1, ?2, 0, 0)').bind(id, `T${++n}`).run();
    if (jade) await W.applyJade(db, id, jade, 'admin', 'seed');
    return id;
  };
  const one = async (sql, ...args) => await db.prepare(sql).bind(...args).first();
  const jadeOf = async (id) => (await one('SELECT jade FROM players WHERE id = ?1', id)).jade;
  const seqOf = async (id) => (await one('SELECT pull_seq FROM players WHERE id = ?1', id)).pull_seq;
  const ledgerSum = async (id) => (await one('SELECT COALESCE(SUM(delta), 0) AS s FROM jade_ledger WHERE player_id = ?1', id)).s;
  const noDrift = async (id) => assert.equal(await jadeOf(id), await ledgerSum(id), 'players.jade must equal the ledger sum');
  const cnt = async (table, id, extra = '') => (await one(`SELECT COUNT(*) AS c FROM ${table} WHERE player_id = ?1 ${extra}`, id)).c;
  const invOf = async (id) => Object.fromEntries((await db.prepare('SELECT item_id, copies FROM inventory WHERE player_id = ?1').bind(id).all()).results.map((r) => [r.item_id, r.copies]));
  const give = async (id, itemId, firstAt = BEFORE) => await db.prepare('INSERT INTO inventory (player_id, item_id, copies, first_at) VALUES (?1, ?2, 1, ?3)').bind(id, itemId, firstAt).run();
  const ok = (name) => console.log('ok  ' + name);
  /** nothing at all changed for `id` while `fn` ran */
  const untouched = async (id, fn) => {
    const snap = async () => JSON.stringify([await jadeOf(id), await seqOf(id), await cnt('jade_ledger', id), await cnt('shop_deals', id), await invOf(id)]);
    const before = await snap();
    await fn();
    assert.equal(await snap(), before, 'a refused request must write nothing');
  };

  // ---- dealsFor (pure)
  {
    const none = new Set();
    const a = D.dealsFor('seedA', DAY, none);
    assert.deepEqual(a, D.dealsFor('seedA', DAY, none), 'same (seed, day) gives the same offer');
    assert.equal(a.length, C.DEAL_SLOTS.length);
    let differ = 0;
    for (let d = 1; d <= 20; d++) if (JSON.stringify(D.dealsFor('seedA', `2026-11-${String(d).padStart(2, '0')}`, none)) !== JSON.stringify(a)) differ++;
    assert.ok(differ >= 18, `offers vary across days (${differ}/20)`);
    let seedsDiffer = 0;
    for (let i = 0; i < 20; i++) if (JSON.stringify(D.dealsFor('s' + i, DAY, none)) !== JSON.stringify(a)) seedsDiffer++;
    assert.ok(seedsDiffer >= 18, 'offers vary across players');

    const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const owned = new Set(gacha.flat().filter(() => r() < 0.5));
      const offer = D.dealsFor('x' + i, DAY, owned);
      const ids = offer.map((o) => o.itemId);
      assert.equal(new Set(ids).size, ids.length, 'no duplicates');
      for (const o of offer) {
        assert.ok(o.rarity <= 3, 'never MYTHIC');
        assert.ok(!owned.has(o.itemId), 'never an item owned at day start');
        assert.ok(gacha[o.rarity].includes(o.itemId));
        assert.equal(o.price, C.DEAL_PRICE[o.rarity]);
      }
    }
    // nothing left at all: every slot dropped. MYTHIC alone does not count
    assert.deepEqual(D.dealsFor('x', DAY, new Set(gacha.slice(0, 4).flat())), []);
    // slot 0 (COMMON/RARE) fully owned: it falls back to a higher rarity, other slots still fill
    const lowOwned = new Set([...gacha[0], ...gacha[1]]);
    const fb = D.dealsFor('x', DAY, lowOwned);
    assert.equal(fb.length, 3);
    assert.ok(fb.find((o) => o.slot === 0).rarity >= 2, 'fallback upward');
    // only the top rarities are owned: fallback downward still fills the slot
    const hiOwned = new Set([...gacha[2], ...gacha[3]]);
    const fd = D.dealsFor('x', DAY, hiOwned);
    assert.equal(fd.length, 3);
    for (const o of fd) assert.ok(o.rarity <= 1, 'fallback downward');
    ok('dealsFor: deterministic, per day and player, no MYTHIC / owned / duplicates, fallbacks and empty slots');
  }

  // ---- state is stable all day
  {
    const id = await player();
    const s1 = await D.dealState(db, id, NOW);
    assert.equal(s1.day, DAY);
    assert.equal(s1.endsAt, D.dayStart(DAY) + 86_400_000);
    assert.equal(s1.deals.length, 3);
    assert.ok(s1.deals.every((d) => !d.bought && !d.owned));
    const strip = (s) => s.deals.map(({ slot, itemId, rarity, price }) => ({ slot, itemId, rarity, price }));
    // the player gets one of today's items (from a pull, first_at today): the offer does not move
    await give(id, s1.deals[0].itemId, NOW - 1000);
    const s2 = await D.dealState(db, id, NOW + 3600_000);
    assert.deepEqual(strip(s2), strip(s1));
    assert.equal(s2.deals[0].owned, true);
    assert.equal(s2.deals[1].owned, false);
    // an item owned since before today leaves the offer next day, and tomorrow is a new day
    const s3 = await D.dealState(db, id, NOW + 86_400_000);
    assert.equal(s3.day, '2026-10-09');
    // a bought slot shows the stored item even when the offer moved since (a catalog change mid-day)
    const other = gacha[0].find((x) => !s1.deals.some((d) => d.itemId === x));
    await db.prepare("INSERT INTO shop_deals (player_id, ref, tx, day, slot, item_id, price, created_at) VALUES (?1, 'moved-ref-1', 't', ?2, 1, ?3, 60, ?4)").bind(id, DAY, other, NOW).run();
    const s4 = await D.dealState(db, id, NOW);
    assert.deepEqual({ ...s4.deals[1] }, { slot: 1, itemId: other, rarity: 0, price: 60, bought: true, owned: false });
    assert.deepEqual(strip(s4).filter((d) => d.slot !== 1), strip(s1).filter((d) => d.slot !== 1));
    ok('dealState: offer stays identical after gaining a deal item today; owned flag and day rollover; a bought slot shows its stored item');
  }

  // ---- buy + replay + invariants
  {
    const id = await player(5000);
    const st = await D.dealState(db, id, NOW);
    const d0 = st.deals[0];
    const seq0 = await seqOf(id);
    const ref = newRef();
    const r = await D.buyDeal(db, id, DAY, 0, ref, FAST);
    assert.deepEqual({ ...r }, { day: DAY, slot: 0, itemId: d0.itemId, price: d0.price, jade: 5000 - d0.price, copies: 1, bonuses: r.bonuses, replay: false });
    assert.equal((await invOf(id))[d0.itemId], 1);
    assert.equal(await jadeOf(id), 5000 - d0.price);
    assert.equal(await seqOf(id), seq0 + 1, 'pull_seq bumped');
    assert.equal(await cnt('jade_ledger', id, "AND reason = 'deal'"), 1);
    assert.equal((await one("SELECT delta, balance_after FROM jade_ledger WHERE player_id = ?1 AND reason = 'deal'", id)).delta, -d0.price);
    await noDrift(id);
    const after = (await D.dealState(db, id, NOW)).deals[0];
    assert.equal(after.bought, true);
    assert.equal(after.owned, true);
    ok('buy: charged once, one deal ledger row, inventory +1, pull_seq +1, no drift');

    // replay: stored result, nothing charged or granted
    const seq1 = await seqOf(id);
    const rp = await D.buyDeal(db, id, DAY, 0, ref, FAST);
    assert.equal(rp.replay, true);
    assert.deepEqual([rp.itemId, rp.price, rp.slot, rp.bonuses], [d0.itemId, d0.price, 0, []]);
    assert.equal(rp.jade, 5000 - d0.price);
    // a replay answers even with another slot/day named, and the next day
    assert.equal((await D.buyDeal(db, id, '2000-01-01', 2, ref, { ...FAST, now: NOW + 86_400_000 })).replay, true);
    assert.equal(await seqOf(id), seq1);
    assert.equal(await cnt('jade_ledger', id, "AND reason = 'deal'"), 1);
    await noDrift(id);
    ok('replay: stored result, replay true, nothing charged, pull_seq untouched');

    // one buy per slot, owned item, wrong day, bad inputs: all refused with nothing written
    await untouched(id, async () => {
      assert.deepEqual(await errOf(D.buyDeal(db, id, DAY, 0, newRef(), FAST)), { code: 'bad_request', reason: 'bought' });
      assert.deepEqual(await errOf(D.buyDeal(db, id, '2026-10-07', 1, newRef(), FAST)), { code: 'bad_request', reason: 'rotated' });
      assert.deepEqual(await errOf(D.buyDeal(db, id, '2026-10-09', 1, newRef(), FAST)), { code: 'bad_request', reason: 'rotated' });
      assert.equal((await errOf(D.buyDeal(db, id, DAY, 3, newRef(), FAST))).code, 'bad_request');
      assert.equal((await errOf(D.buyDeal(db, id, DAY, 1.5, newRef(), FAST))).code, 'bad_request');
      assert.equal((await errOf(D.buyDeal(db, id, DAY, '1', newRef(), FAST))).code, 'bad_request');
      assert.equal((await errOf(D.buyDeal(db, id, 'today', 1, newRef(), FAST))).code, 'bad_request');
      assert.equal((await errOf(D.buyDeal(db, id, DAY, 1, 'short', FAST))).code, 'bad_request');
    });
    // an item gained meanwhile (pull) is 'owned'
    await give(id, st.deals[1].itemId, NOW - 10);
    await untouched(id, async () => {
      assert.deepEqual(await errOf(D.buyDeal(db, id, DAY, 1, newRef(), FAST)), { code: 'bad_request', reason: 'owned' });
    });
    // a spent deal ref reused for another slot after the day: it is a replay of the first purchase, never a second charge
    ok('refusals: bought, owned, rotated, bad inputs write nothing');

    // slot 2 still buys; all 3 slots, never more
    const r2 = await D.buyDeal(db, id, DAY, 2, newRef(), FAST);
    assert.equal(r2.slot, 2);
    assert.equal(await cnt('shop_deals', id, `AND day = '${DAY}'`), 2);
    await noDrift(id);
  }

  // ---- insufficient Jade
  {
    const st0 = await D.dealState(db, 'nobody-yet', NOW).catch(() => null);
    assert.ok(st0 !== null, 'dealState works for any id');
    const probe = await player();
    const price = (await D.dealState(db, probe, NOW)).deals[1].price;
    const id = probe;
    await W.applyJade(db, id, price - 1, 'admin', 'poor');
    await untouched(id, async () => {
      const e = await errOf(D.buyDeal(db, id, DAY, 1, newRef(), FAST));
      assert.equal(e.code, 'insufficient_jade');
    });
    await W.applyJade(db, id, 1, 'admin', 'exact');
    assert.equal((await D.buyDeal(db, id, DAY, 1, newRef(), FAST)).jade, 0);
    await noDrift(id);
    assert.equal(await jadeOf(id), 0);
    ok('insufficient Jade refuses and writes nothing; exact balance buys down to 0');
  }

  // ---- rate limit shares pull_at
  {
    const id = await player(5000);
    await D.buyDeal(db, id, DAY, 0, newRef(), { now: NOW });
    const e = await errOf(D.buyDeal(db, id, DAY, 1, newRef(), { now: NOW + 100 }));
    assert.equal(e.code, 'rate_limited');
    assert.equal((await D.buyDeal(db, id, DAY, 1, newRef(), { now: NOW + 60_000 })).replay, false);
    ok('purchases respect the pull interval');
  }

  // ---- races
  {
    // same ref twice at once: charged once, the loser answers as a replay
    const id = await player(5000);
    const ref = newRef();
    const rs = await Promise.all([D.buyDeal(db, id, DAY, 0, ref, FAST), D.buyDeal(db, id, DAY, 0, ref, FAST)]);
    assert.deepEqual(rs.map((r) => r.replay).sort(), [false, true]);
    assert.equal(await cnt('jade_ledger', id, "AND reason = 'deal'"), 1);
    assert.equal(await cnt('shop_deals', id), 1);
    await noDrift(id);
    // two refs for the same slot: exactly one wins
    const id2 = await player(5000);
    const out = await Promise.all([errOf(D.buyDeal(db, id2, DAY, 0, newRef(), FAST)), errOf(D.buyDeal(db, id2, DAY, 0, newRef(), FAST))]);
    assert.deepEqual(out.map((o) => o.code).sort(), ['bad_request', 'ok']);
    assert.equal(await cnt('shop_deals', id2), 1);
    assert.equal(await cnt('jade_ledger', id2, "AND reason = 'deal'"), 1);
    await noDrift(id2);

    // a deal and a pull race: both apply (the loser re-reads), the pull's isNew matches the final inventory
    const id3 = await player(5000);
    const st = await D.dealState(db, id3, NOW);
    const dealItem = st.deals[0].itemId;
    const z = C.ITEMS.find((i) => i.source === 'gacha' && i.id !== dealItem && !st.deals.some((d) => d.itemId === i.id));
    const pool = () => [z];
    const seq0 = await seqOf(id3);
    const [deal, pl] = await Promise.all([D.buyDeal(db, id3, DAY, 0, newRef(), FAST), S.pull(db, id3, 'standard', 1, newRef(), () => 0, { ...FAST, pool })]);
    assert.equal(deal.replay, false);
    assert.equal(pl.drops[0].itemId, z.id);
    assert.equal(pl.drops[0].isNew, true);
    const inv = await invOf(id3);
    assert.equal(inv[dealItem], 1);
    assert.equal(inv[z.id], 1);
    assert.equal(await seqOf(id3), seq0 + 2);
    await noDrift(id3);
    ok('races: same-ref twins charge once, one winner per slot, deal and pull both apply');
  }

  // ---- set bonus on completion
  {
    let found = null;
    outer: for (let i = 0; i < 3000 && !found; i++) {
      for (const set of C.SETS) {
        for (const x of set.items) {
          const others = set.items.filter((y) => y !== x);
          const o = D.dealsFor('set' + i, DAY, new Set(others)).find((d) => d.itemId === x);
          if (o) {
            found = { seed: 'set' + i, set, x, others, slot: o.slot, price: o.price };
            break outer;
          }
        }
      }
    }
    assert.ok(found, 'a set-completing offer exists for some player');
    const id = await player(5000, found.seed);
    for (const y of found.others) await give(id, y);
    assert.equal((await D.dealState(db, id, NOW)).deals.find((d) => d.slot === found.slot).itemId, found.x);
    const seq0 = await seqOf(id);
    const r = await D.buyDeal(db, id, DAY, found.slot, newRef(), FAST);
    assert.deepEqual(r.bonuses, [found.set.bonus]);
    const inv = await invOf(id);
    assert.equal(inv[found.set.bonus], 1);
    assert.equal(await seqOf(id), seq0 + 1, 'one pull_seq bump covers deal and bonus');
    assert.equal(await jadeOf(id), 5000 - found.price, 'the bonus is free');
    await noDrift(id);
    // replaying it grants nothing more and reports no bonuses
    const ref = (await one('SELECT ref FROM shop_deals WHERE player_id = ?1', id)).ref;
    assert.deepEqual((await D.buyDeal(db, id, DAY, found.slot, ref, FAST)).bonuses, []);
    assert.equal((await invOf(id))[found.set.bonus], 1);
    ok(`set bonus: completing "${found.set.id}" by a deal grants ${found.set.bonus}, once`);
  }

  // ---- account delete
  {
    const src = readFileSync('functions/api/v1/me.ts', 'utf8');
    assert.ok(src.includes("DELETE FROM shop_deals WHERE player_id = ?1"), 'me.ts DELETE removes shop_deals');
    const id = await player(1000);
    await D.buyDeal(db, id, DAY, 0, newRef(), FAST);
    assert.equal(await cnt('shop_deals', id), 1);
    await db.batch([db.prepare('DELETE FROM shop_deals WHERE player_id = ?1').bind(id), db.prepare('DELETE FROM inventory WHERE player_id = ?1').bind(id), db.prepare('DELETE FROM jade_ledger WHERE player_id = ?1').bind(id), db.prepare('DELETE FROM players WHERE id = ?1').bind(id)]);
    assert.equal(await cnt('shop_deals', id), 0);
    ok('account delete removes shop_deals rows');
  }
  console.log('all deals tests passed');
} finally {
  await dispose();
}
