// Proves the continue invariants (server/continues.ts, checkRun) against a real (local, throwaway) D1: `npm run test:continue`.
//  - checkRun: rush accepts 3 + continues wrong answers, continues only on ticketed rush runs, at most CONTINUE.max
//  - Jade continues: 10 / 10 / 20, one charge per (ticket, n), replay, sequence, max, closed/foreign runs, no Jade
//  - ad continues: only continue 1, need a verified unclaimed reward for the ticket, claim it once, daily cap
//  - AdMob SSV: a genuine signature verifies; tampering, wrong key, bad DER and foreign ad units do not
import { build } from 'esbuild';
import { getPlatformProxy } from 'wrangler';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const tmp = mkdtempSync(join(tmpdir(), 'hr-continue-'));
await build({
  entryPoints: { continues: 'server/continues.ts', wallet: 'server/wallet.ts', api: 'shared/api.ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outdir: tmp,
  outExtension: { '.js': '.mjs' },
  logLevel: 'error',
});
const imp = (n) => import(pathToFileURL(join(tmp, n + '.mjs')).href);
const K = await imp('continues');
const W = await imp('wallet');
const A = await imp('api');

const NOW = Date.UTC(2026, 9, 8, 5, 0, 0); // 12:00 Bangkok
const errOf = async (p) => {
  try {
    await p;
  } catch (e) {
    return { code: e.code ?? String(e), reason: e.opts?.reason };
  }
  return { code: 'ok' };
};
const ok = (name) => console.log('ok  ' + name);

// ---- checkRun (pure)
{
  const board = A.boardKey('quiz', 1, 'rush');
  // 10 correct then a miss each time: score = 10 × round(1.05..1.5 × 100) is not needed, use the lower bound
  const run = (wrong, continues, extra = {}) => {
    const correct = 10;
    return { board, score: correct * A.baseFor(1) * 2, correct, asked: correct + wrong, maxCombo: correct, durationMs: 600_000, continues, ...extra };
  };
  assert.equal(A.checkRun(run(3, undefined)), null);
  assert.equal(A.checkRun(run(3, 0)), null);
  assert.equal(A.checkRun(run(4, 1)), null);
  assert.equal(A.checkRun(run(6, 3)), null);
  assert.equal(A.checkRun(run(4, 0)), 'rush_lives');
  assert.equal(A.checkRun(run(3, 1)), 'rush_lives');
  assert.equal(A.checkRun(run(7, 4)), 'continues_range');
  assert.equal(A.checkRun(run(4, -1)), 'continues_range');
  assert.equal(A.checkRun(run(4, 1.5)), 'continues_range');
  assert.equal(A.checkRun(run(4, 1), false), 'continues_scope');
  const zen = { board: A.boardKey('quiz', 1, 'zen'), score: 20 * A.baseFor(1) * 2, correct: 20, asked: 20, maxCombo: 20, durationMs: 600_000 };
  assert.equal(A.checkRun(zen), null);
  assert.equal(A.checkRun({ ...zen, continues: 1 }), 'continues_scope');
  assert.deepEqual([1, 2, 3, 4].map(A.continueCost), [10, 10, 20, Infinity]);
  ok('checkRun: rush lives = 3 + continues, ticketed rush only, at most 3');
}

// ---- SSV signatures (pure)
const p1363ToDer = (raw) => {
  const int = (b) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    b = b.subarray(i);
    return b[0] & 0x80 ? [0x02, b.length + 1, 0, ...b] : [0x02, b.length, ...b];
  };
  const body = [...int(raw.subarray(0, 32)), ...int(raw.subarray(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
};
const b64url = (u8) => Buffer.from(u8).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const keys = (id) => Promise.resolve(id === '42' ? pair.publicKey : id === '7' ? other.publicKey : null);
const signedQuery = async (fields, key = pair.privateKey, keyId = '42') => {
  const msg = new URLSearchParams(fields).toString();
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(msg)));
  return `${msg}&signature=${b64url(p1363ToDer(raw))}&key_id=${keyId}`;
};
const fields = (custom, tx = 'tx-1', unit = '5224354917') => ({
  ad_network: '5450213213286189855',
  ad_unit: unit,
  custom_data: custom,
  reward_amount: '1',
  reward_item: 'heart',
  timestamp: String(NOW),
  transaction_id: tx,
});
{
  const q = await signedQuery(fields('TICKET-abcdef'));
  assert.deepEqual(await K.verifyAdmobSsv(q, keys), { transactionId: 'tx-1', customData: 'TICKET-abcdef', adUnit: '5224354917' });
  assert.deepEqual(await K.verifyAdmobSsv(q, keys, ['5224354917']), { transactionId: 'tx-1', customData: 'TICKET-abcdef', adUnit: '5224354917' });
  assert.equal(await K.verifyAdmobSsv(q, keys, ['1111']), null, 'foreign ad unit');
  assert.equal(await K.verifyAdmobSsv(q.replace('TICKET-abcdef', 'TICKET-zzzzzz'), keys), null, 'tampered custom data');
  assert.equal(await K.verifyAdmobSsv(q.replace('key_id=42', 'key_id=7'), keys), null, 'other key');
  assert.equal(await K.verifyAdmobSsv(q.replace('key_id=42', 'key_id=9'), keys), null, 'unknown key');
  assert.equal(await K.verifyAdmobSsv(q.replace(/signature=[^&]+/, 'signature=AAAA'), keys), null, 'bad DER');
  assert.equal(await K.verifyAdmobSsv(q.replace(/&signature=.*/, ''), keys), null, 'unsigned');
  const noCustom = await signedQuery({ ...fields('x'), custom_data: '' });
  assert.equal(await K.verifyAdmobSsv(noCustom, keys), null, 'no custom data');
  // DER integers with a leading 0x00 and short integers round-trip
  for (let i = 0; i < 40; i++) {
    const raw = crypto.getRandomValues(new Uint8Array(64));
    if (i % 4 === 0) raw[0] = 0x80;
    if (i % 4 === 1) raw.fill(0, 32, 34);
    assert.deepEqual(K.derToP1363(p1363ToDer(raw)), raw);
  }
  // Google's published key format imports (fetched live only if reachable)
  try {
    const res = await fetch(K.ADMOB_KEYS_URL);
    const body = await res.json();
    assert.ok(body.keys.length > 0);
    assert.ok(await K.googleKeys(String(body.keys[0].keyId)), 'imports a Google key');
    ok('googleKeys: imports the live Google key list');
  } catch (e) {
    if (e instanceof assert.AssertionError) throw e;
    console.log('skip googleKeys (offline)');
  }
  ok('verifyAdmobSsv: genuine passes; tampering, wrong key, bad DER, foreign unit fail');
}

const { env, dispose } = await getPlatformProxy({ persist: { path: join(tmp, 'state') } });
const db = env.DB;
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
  const ticket = async (pid, opts = {}) => {
    const t = `tk${String(++n).padStart(10, '0')}`;
    await db
      .prepare("INSERT INTO runs (id, player_id, board, created_at, status) VALUES (?1, ?2, 'quiz-1-rush', ?3, ?4)")
      .bind(t, pid, opts.createdAt ?? NOW - 60_000, opts.status ?? 'open')
      .run();
    return t;
  };
  const one = async (sql, ...args) => await db.prepare(sql).bind(...args).first();
  const jadeOf = async (id) => (await one('SELECT jade FROM players WHERE id = ?1', id)).jade;
  const contOf = async (t) => (await one('SELECT continues FROM runs WHERE id = ?1', t)).continues;
  const ledger = async (id) => (await one("SELECT COUNT(*) AS c FROM jade_ledger WHERE player_id = ?1 AND reason = 'continue'", id)).c;
  const go = (pid, t, k, via, opts = {}) => K.continueRun(db, pid, t, k, via, { now: NOW, ...opts });

  // ---- Jade continues
  {
    const p = await player(100);
    const t = await ticket(p);
    const r1 = await go(p, t, 1, 'jade');
    assert.deepEqual(r1, { n: 1, via: 'jade', cost: 10, jade: 90, replay: false });
    assert.deepEqual(await go(p, t, 1, 'jade'), { ...r1, replay: true }, 'replay');
    assert.equal(await jadeOf(p), 90);
    assert.deepEqual(await errOf(go(p, t, 3, 'jade')), { code: 'continue_refused', reason: 'sequence' });
    assert.equal((await go(p, t, 2, 'jade')).cost, 10);
    assert.equal((await go(p, t, 3, 'jade')).cost, 20);
    assert.deepEqual(await errOf(go(p, t, 4, 'jade')), { code: 'continue_refused', reason: 'max' });
    assert.equal(await jadeOf(p), 60);
    assert.equal(await contOf(t), 3);
    assert.equal(await ledger(p), 3);
    // a replayed earlier continue is still answered after later ones
    assert.equal((await go(p, t, 2, 'jade')).replay, true);
    assert.equal(await jadeOf(p), 60);
    // same-ref twins charge once
    const t2 = await ticket(p);
    const twins = await Promise.all([go(p, t2, 1, 'jade'), go(p, t2, 1, 'jade'), go(p, t2, 1, 'jade')]);
    assert.equal(twins.filter((r) => !r.replay).length, 1);
    assert.equal(await jadeOf(p), 50);
    assert.equal(await contOf(t2), 1);
    ok('jade: 10 / 10 / 20, replay free, sequence and max refused, twins charge once');
  }
  {
    const poor = await player(5);
    const t = await ticket(poor);
    const e = await errOf(go(poor, t, 1, 'jade'));
    assert.equal(e.code, 'insufficient_jade');
    assert.equal(await jadeOf(poor), 5);
    assert.equal(await contOf(t), 0);
    assert.equal(await ledger(poor), 0);
    ok('jade: insufficient balance writes nothing');
  }
  {
    const p = await player(100);
    const q = await player(100);
    const tq = await ticket(q);
    assert.equal((await errOf(go(p, tq, 1, 'jade'))).code, 'ticket_invalid');
    assert.equal((await errOf(go(p, 'nope-nope-nope', 1, 'jade'))).code, 'ticket_invalid');
    const done = await ticket(p, { status: 'ok' });
    assert.deepEqual(await errOf(go(p, done, 1, 'jade')), { code: 'continue_refused', reason: 'closed' });
    const old = await ticket(p, { createdAt: NOW - A.LIMITS.ticketTtlMs - 1 });
    assert.deepEqual(await errOf(go(p, old, 1, 'jade')), { code: 'continue_refused', reason: 'closed' });
    for (const [t, k, via] of [['bad ticket!', 1, 'jade'], [tq, 0, 'jade'], [tq, 1.5, 'jade'], [tq, 1, 'iap']]) {
      assert.equal((await errOf(go(q, t, k, via))).code, 'bad_request');
    }
    assert.equal(await jadeOf(p), 100);
    assert.equal(await jadeOf(q), 100);
    ok('refusals: foreign, unknown, closed, expired tickets and bad input charge nothing');
  }

  // ---- ad continues
  {
    const p = await player(0);
    const t = await ticket(p);
    assert.equal((await errOf(go(p, t, 1, 'ad'))).code, 'ad_unverified');
    await K.storeAdReward(db, { transactionId: 'tx-a1', customData: t, adUnit: 'u' }, NOW);
    await K.storeAdReward(db, { transactionId: 'tx-a1', customData: t, adUnit: 'u' }, NOW); // AdMob retry
    assert.deepEqual(await go(p, t, 1, 'ad'), { n: 1, via: 'ad', cost: 0, jade: 0, replay: false });
    assert.deepEqual(await go(p, t, 1, 'ad'), { n: 1, via: 'ad', cost: 0, jade: 0, replay: true });
    assert.equal(await contOf(t), 1);
    assert.equal((await one('SELECT player_id FROM ad_rewards WHERE transaction_id = ?1', 'tx-a1')).player_id, p);
    // continue 2 cannot be an ad, even with a reward waiting
    await K.storeAdReward(db, { transactionId: 'tx-a2', customData: t, adUnit: 'u' }, NOW);
    assert.deepEqual(await errOf(go(p, t, 2, 'ad')), { code: 'continue_refused', reason: 'ad_slot' });
    // a reward for another player's ticket cannot be claimed by me
    const q = await player(0);
    const tq = await ticket(q);
    await K.storeAdReward(db, { transactionId: 'tx-q', customData: tq, adUnit: 'u' }, NOW);
    const t3 = await ticket(p);
    assert.equal((await errOf(go(p, t3, 1, 'ad'))).code, 'ad_unverified');
    // twins claim one reward
    await K.storeAdReward(db, { transactionId: 'tx-t3a', customData: t3, adUnit: 'u' }, NOW);
    await K.storeAdReward(db, { transactionId: 'tx-t3b', customData: t3, adUnit: 'u' }, NOW);
    const twins = await Promise.all([go(p, t3, 1, 'ad'), go(p, t3, 1, 'ad')]);
    assert.equal(twins.filter((r) => !r.replay).length, 1);
    assert.equal((await one('SELECT COUNT(*) AS c FROM ad_rewards WHERE custom_data = ?1 AND player_id IS NOT NULL', t3)).c, 1);
    ok('ad: needs a verified reward for the ticket, continue 1 only, claimed once');
  }
  {
    const p = await player(0);
    for (let i = 0; i < A.CONTINUE.adsPerDay; i++) {
      const t = await ticket(p);
      await K.storeAdReward(db, { transactionId: `cap-${i}`, customData: t, adUnit: 'u' }, NOW);
      await go(p, t, 1, 'ad');
    }
    const t = await ticket(p);
    await K.storeAdReward(db, { transactionId: 'cap-x', customData: t, adUnit: 'u' }, NOW);
    assert.deepEqual(await errOf(go(p, t, 1, 'ad')), { code: 'continue_refused', reason: 'ad_cap' });
    // the next Bangkok day the cap resets
    const tomorrow = await ticket(p, { createdAt: NOW + 86_400_000 - 60_000 });
    await K.storeAdReward(db, { transactionId: 'cap-y', customData: tomorrow, adUnit: 'u' }, NOW + 86_400_000);
    assert.equal((await go(p, tomorrow, 1, 'ad', { now: NOW + 86_400_000 })).replay, false);
    ok(`ad: ${A.CONTINUE.adsPerDay} per Bangkok day`);
  }
  {
    const p = await player(0);
    const t = await ticket(p);
    assert.equal((await go(p, t, 1, 'ad', { trustAds: true })).replay, false);
    ok('ad: the dev bypass needs no callback');
  }

  // ---- POST /runs and account delete read the column
  {
    const src = readFileSync('functions/api/v1/runs/index.ts', 'utf8');
    assert.ok(src.includes('(req.continues ?? 0) > tk.continues'), 'POST /runs compares the submitted continues with the ticket');
    assert.ok(readFileSync('functions/api/v1/me.ts', 'utf8').includes('DELETE FROM ad_rewards WHERE player_id = ?1'), 'me.ts DELETE removes ad_rewards');
    ok('POST /runs checks continues against the ticket; account delete removes ad rewards');
  }
  console.log('all continue tests passed');
} finally {
  await dispose();
}
