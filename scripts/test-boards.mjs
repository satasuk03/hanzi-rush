// Leaderboard reads against a real (local, throwaway) D1: `npm run test:boards`.
//  - the split rank counts give exactly the old `a OR b` ranks, ties included
//  - they read only the rows ahead, not the whole board
//  - serveBoard marks the caller's row (isMe) and returns `me`, signed in or not
import { build } from 'esbuild';
import { getPlatformProxy } from 'wrangler';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const tmp = mkdtempSync(join(tmpdir(), 'hr-boards-'));
const out = join(tmp, 'boards.mjs');
await build({ stdin: { contents: "export * from './server/boards'; export * from './server/effort'; export * from './server/boardRoute';", resolveDir: '.', loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const B = await import(pathToFileURL(out).href);

const { env, dispose } = await getPlatformProxy({ persist: { path: join(tmp, 'state') } });
const db = env.DB;
try {
  for (const f of readdirSync('migrations').sort()) {
    const sql = readFileSync(join('migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt.replace(/\s+/g, ' ')).run();
  }
  const ok = (name) => console.log('ok  ' + name);
  const BOARD = 'quiz:hsk1';
  const N = 200;
  // scores with plenty of ties (score % 20) and tie-breaks on achieved_at
  const stmts = [];
  for (let i = 0; i < N; i++) {
    const id = `p${i}`;
    stmts.push(db.prepare("INSERT INTO players (id, tag, pub, created_at, last_seen_at) VALUES (?1, 'TAG', ?2, 0, 0)").bind(id, `PUB${String(i).padStart(5, '0')}`));
    stmts.push(db.prepare("INSERT INTO scores (board, period, player_id, score, achieved_at, run_id, verified) VALUES (?1, 'all', ?2, ?3, ?4, 'r', 1)").bind(BOARD, id, (i * 7) % 20, (i * 13) % 50));
    stmts.push(db.prepare("INSERT INTO effort (period, player_id, correct, asked, runs, duration_ms, updated_at) VALUES ('all', ?1, ?2, 0, 1, 0, ?3)").bind(id, (i * 3) % 15, (i * 11) % 40));
  }
  await db.batch(stmts);

  // ---- ranks equal the old OR formula
  {
    const old = await db
      .prepare(
        `SELECT s.player_id AS id, (SELECT COUNT(*) + 1 FROM scores o WHERE o.board = ?1 AND o.period = 'all'
           AND (o.score > s.score OR (o.score = s.score AND o.achieved_at < s.achieved_at))) AS rank FROM scores s WHERE s.board = ?1 AND s.period = 'all'`,
      )
      .bind(BOARD)
      .all();
    for (const r of old.results) assert.equal((await B.myEntry(env, BOARD, 'all', r.id)).rank, r.rank, `score rank of ${r.id}`);
    const oldE = await db
      .prepare(
        `SELECT e.player_id AS id, (SELECT COUNT(*) + 1 FROM effort o WHERE o.period = 'all'
           AND (o.correct > e.correct OR (o.correct = e.correct AND o.updated_at < e.updated_at))) AS rank FROM effort e WHERE e.period = 'all'`,
      )
      .all();
    for (const r of oldE.results) assert.equal((await B.myEffort(env, 'all', r.id)).rank, r.rank, `effort rank of ${r.id}`);
    ok('ranks match the old formula, ties included');
  }

  // ---- the top player reads a handful of rows, not the board
  {
    const topId = (await B.top(env, BOARD, 'all', 1, null))[0];
    const first = (await db.prepare("SELECT player_id FROM scores WHERE board = ?1 AND period = 'all' ORDER BY score DESC, achieved_at ASC LIMIT 1").bind(BOARD).first()).player_id;
    assert.equal(topId.rank, 1);
    const r = await db
      .prepare("SELECT (SELECT COUNT(*) FROM scores o WHERE o.board = ?1 AND o.period = 'all' AND o.score > s.score) + (SELECT COUNT(*) FROM scores o WHERE o.board = ?1 AND o.period = 'all' AND o.score = s.score AND o.achieved_at < s.achieved_at) + 1 AS rank FROM scores s WHERE s.board = ?1 AND s.period = 'all' AND s.player_id = ?2")
      .bind(BOARD, first)
      .all();
    const o = await db
      .prepare("SELECT (SELECT COUNT(*) + 1 FROM scores o WHERE o.board = ?1 AND o.period = 'all' AND (o.score > s.score OR (o.score = s.score AND o.achieved_at < s.achieved_at))) AS rank FROM scores s WHERE s.board = ?1 AND s.period = 'all' AND s.player_id = ?2")
      .bind(BOARD, first)
      .all();
    console.log(`    rank of #1 on a ${N}-row board: rows read ${o.meta.rows_read} -> ${r.meta.rows_read}`);
    assert.ok(r.meta.rows_read < 20, `new rank query should read few rows, read ${r.meta.rows_read}`);
    assert.ok(o.meta.rows_read >= N, 'baseline: the old query scans the board');
    ok('rank reads only the rows ahead');
  }

  // ---- ranksOf: totals come through (no edge cache in node) and are never below the rank
  {
    const keys = { day: 'd2000-01-01', week: 'w2000-01-01', dayResetsAt: 0, weekResetsAt: 0 };
    const r = await B.ranksOf(env, BOARD, keys, 'p5', 'http://localhost');
    assert.equal(r.all.total, N);
    assert.equal(r.all.rank, (await B.myEntry(env, BOARD, 'all', 'p5')).rank);
    assert.deepEqual(r.day, { rank: null, best: 0, total: 0 });
    ok('ranksOf');
  }

  // ---- serveBoard: anonymous vs signed in
  {
    const token = 'hr1.' + 'a'.repeat(32);
    const hash = createHash('sha256').update(token).digest('hex');
    await db.prepare("INSERT INTO sessions (token_hash, player_id, created_at, last_used_at, via) VALUES (?1, 'p4', 0, 0, 'guest')").bind(hash).run();
    const ctx = (auth) => ({
      request: new Request('http://localhost/api/v1/boards/effort?period=all&limit=100', { headers: auth ? { Authorization: `Bearer ${auth}` } : {} }),
      env,
      waitUntil: () => {},
    });
    const src = {
      key: 'effort',
      shared: async (pk, limit) => ({ entries: await B.topEffort(env, pk, limit, null), total: await B.totalEffort(env, pk) }),
      mine: (pk, id) => B.myEffort(env, pk, id),
    };
    const anon = await (await B.serveBoard(ctx(null), src, (p) => p)).json();
    assert.equal(anon.me, null);
    assert.equal(anon.entries.filter((e) => e.isMe).length, 0);
    assert.equal(anon.total, N);
    const signed = await (await B.serveBoard(ctx(token), src, (p) => p)).json();
    assert.equal(signed.me.pid, 'PUB00004');
    const mineRows = signed.entries.filter((e) => e.isMe);
    assert.equal(mineRows.length, 1);
    assert.equal(mineRows[0].pid, 'PUB00004');
    assert.equal(mineRows[0].rank, signed.me.rank);
    ok('serveBoard marks the caller');
  }
} finally {
  await dispose();
  rmSync(tmp, { recursive: true, force: true });
}
