// Proves nobody can wear what they do not own against a real (local, throwaway) D1: `node scripts/test-ownership.mjs`.
import { build } from 'esbuild';
import { getPlatformProxy } from 'wrangler';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const tmp = mkdtempSync(join(tmpdir(), 'hr-own-'));
const out = join(tmp, 'inventory.mjs');
const cosOut = join(tmp, 'cosmetics.mjs');
await build({ entryPoints: ['shared/cosmetics.ts'], bundle: true, format: 'esm', platform: 'node', outfile: cosOut, logLevel: 'error' });
const C = await import(pathToFileURL(cosOut).href);
await build({ entryPoints: ['server/inventory.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const I = await import(pathToFileURL(out).href);

const { env, dispose } = await getPlatformProxy({ persist: { path: join(tmp, 'state') } });
const db = env.DB;
try {
  for (const f of readdirSync('migrations').sort()) {
    const sql = readFileSync(join('migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt.replace(/\s+/g, ' ')).run();
  }
  let n = 0;
  const player = async (...items) => {
    const id = `p${++n}`;
    await db.prepare('INSERT INTO players (id, tag, created_at, last_seen_at) VALUES (?1, ?2, 0, 0)').bind(id, `T${n}`).run();
    for (const it of items) await db.prepare('INSERT INTO inventory (player_id, item_id, copies, first_at) VALUES (?1, ?2, 1, 0)').bind(id, it).run();
    return id;
  };
  const ok = (name) => console.log('ok  ' + name);

  {
    const id = await player();
    assert.deepEqual(await I.ownedLook(db, id, {}), {});
    ok('empty look stays empty');
  }
  {
    const id = await player('avatar_panda', 'frame_a', 'fx_a', 'b1', 'b2');
    const look = { frame: 'frame_a', avatar: 'avatar_panda', nameFx: 'fx_a', badges: ['b1', 'b2'] };
    assert.deepEqual(await I.ownedLook(db, id, look), look);
    ok('all owned is kept');
  }
  {
    const id = await player();
    assert.deepEqual(await I.ownedLook(db, id, { frame: 'frame_a', avatar: 'avatar_dragon', nameFx: 'fx_a' }), {});
    ok('unowned frame, avatar and nameFx are dropped');
  }
  {
    const id = await player('avatar_panda', 'b3', 'b1');
    const r = await I.ownedLook(db, id, { avatar: 'avatar_panda', frame: 'frame_a', badges: ['b1', 'b2', 'b3'] });
    assert.deepEqual(r, { avatar: 'avatar_panda', badges: ['b1', 'b3'] });
    ok('mixed badges keep only owned ones, in order');
  }
  {
    await player('avatar_dragon');
    const id = await player('avatar_panda');
    assert.deepEqual(await I.ownedLook(db, id, { avatar: 'avatar_dragon' }), {});
    ok("another player's inventory does not count");
  }
  {
    const bonus = 'badge_set_bamboo';
    assert.deepEqual(C.sanitizeLook({ badges: [bonus] }), { badges: [bonus] }, 'sanitizeLook keeps set bonus badges');
    const look = C.sanitizeLook({ badges: [bonus] });
    const none = await player();
    assert.deepEqual(await I.ownedLook(db, none, look), {});
    const has = await player(bonus);
    assert.deepEqual(await I.ownedLook(db, has, look), look);
    ok('set bonus badges survive sanitizeLook and need ownership');
  }
  console.log('ownership: all ok');
} finally {
  await dispose();
}
process.exit(0);
