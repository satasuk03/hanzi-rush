// Proves the continue invariants (server/continues.ts, checkRun) against a real (local, throwaway) D1: `npm run test:continue`.
//  - checkRun: rush accepts 3 + continues wrong answers, continues only on ticketed rush runs, at most CONTINUE.max
//  - Jade continues: 10 / 10 / 20, one charge per (ticket, n), replay, sequence, max, closed/foreign runs, no Jade
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
    for (const [t, k, via] of [['bad ticket!', 1, 'jade'], [tq, 0, 'jade'], [tq, 1.5, 'jade'], [tq, 1, 'ad'], [tq, 1, 'iap']]) {
      assert.equal((await errOf(go(q, t, k, via))).code, 'bad_request');
    }
    assert.equal(await jadeOf(p), 100);
    assert.equal(await jadeOf(q), 100);
    ok('refusals: foreign, unknown, closed, expired tickets and bad input charge nothing');
  }

  // ---- POST /runs and account delete read the column
  {
    const src = readFileSync('functions/api/v1/runs/index.ts', 'utf8');
    assert.ok(src.includes('(req.continues ?? 0) > tk.continues'), 'POST /runs compares the submitted continues with the ticket');
    assert.ok(readFileSync('functions/api/v1/me.ts', 'utf8').includes('DELETE FROM ad_rewards WHERE player_id = ?1'), 'me.ts DELETE removes legacy ad_rewards');
    ok('POST /runs checks continues against the ticket; account delete still removes legacy ad rewards');
  }
  console.log('all continue tests passed');
} finally {
  await dispose();
}
