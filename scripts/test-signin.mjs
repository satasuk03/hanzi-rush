// Proves the sign-in invariants (server/oidc.ts, server/identity.ts) against a real (local, throwaway) D1: `npm run test:signin`.
//  - verifyJwt: a genuine RS256 token verifies; bad signature, wrong iss/aud, expired, unknown kid and alg=none do not;
//    an unknown kid refetches the keys once (rotation)
//  - signInOrLink: links to the caller, is idempotent, signs a new device into the linked player, 404s without a caller,
//    refuses a second account of the same provider, and never signs into a disabled player
import { build } from 'esbuild';
import { getPlatformProxy } from 'wrangler';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { webcrypto as crypto } from 'node:crypto';
import assert from 'node:assert/strict';

const tmp = mkdtempSync(join(tmpdir(), 'hr-signin-'));
await build({
  entryPoints: { oidc: 'server/oidc.ts', identity: 'server/identity.ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outdir: tmp,
  outExtension: { '.js': '.mjs' },
  logLevel: 'error',
});
const imp = (n) => import(pathToFileURL(join(tmp, n + '.mjs')).href);
const O = await imp('oidc');
const I = await imp('identity');
const ok = (name) => console.log('ok  ' + name);
const errOf = async (p) => {
  try {
    await p;
  } catch (e) {
    return e.code ?? String(e);
  }
  return null;
};

// ---- verifyJwt
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const mkKey = async (kid) => {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  return { kid, priv: kp.privateKey, jwk: { kid, kty: 'RSA', alg: 'RS256', n: pub.n, e: pub.e } };
};
const sign = async (key, claims, header = { alg: 'RS256', kid: key.kid }) => {
  const head = b64u(JSON.stringify(header)) + '.' + b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.priv, new TextEncoder().encode(head));
  return head + '.' + b64u(sig);
};
{
  const k1 = await mkKey('k1');
  const k2 = await mkKey('k2');
  const NOW = 1_800_000_000_000;
  const now = NOW / 1000;
  const base = { iss: 'https://accounts.google.com', aud: 'web-client', sub: 'g-123', email: 'A@x.io', email_verified: true, iat: now - 10, exp: now + 3600 };
  let published = [k1.jwk];
  let fetches = 0;
  const opts = { getKeys: async () => (fetches++, published), issuers: ['https://accounts.google.com'], audiences: ['web-client', 'ios-client'], now: NOW };

  const c = await O.verifyJwt(await sign(k1, base), opts);
  assert.equal(c.sub, 'g-123');
  assert.equal(await errOf(O.verifyJwt(await sign(k1, { ...base, aud: ['other', 'ios-client'] }), opts)), null);
  ok('a genuine token verifies (aud may be a list)');

  const good = await sign(k1, base);
  const [h, p] = good.split('.');
  const forged = h + '.' + b64u(JSON.stringify({ ...base, sub: 'victim' })) + '.' + good.split('.')[2];
  assert.equal(await errOf(O.verifyJwt(forged, opts)), 'unauthorized');
  assert.equal(await errOf(O.verifyJwt(await sign(k2, base, { alg: 'RS256', kid: 'k1' }), opts)), 'unauthorized');
  assert.equal(await errOf(O.verifyJwt(h + '.' + p + '.', opts)), 'unauthorized');
  assert.equal(await errOf(O.verifyJwt(b64u(JSON.stringify({ alg: 'none', kid: 'k1' })) + '.' + p + '.', opts)), 'unauthorized');
  ok('tampered claims, a wrong key, an empty signature and alg=none are rejected');

  assert.equal(await errOf(O.verifyJwt(await sign(k1, { ...base, iss: 'https://evil.example' }), opts)), 'unauthorized');
  assert.equal(await errOf(O.verifyJwt(await sign(k1, { ...base, aud: 'someone-else' }), opts)), 'unauthorized');
  assert.equal(await errOf(O.verifyJwt(await sign(k1, { ...base, exp: now - 600 }), opts)), 'unauthorized');
  assert.equal(await errOf(O.verifyJwt(await sign(k1, { ...base, sub: '' }), opts)), 'unauthorized');
  assert.equal(await errOf(O.verifyJwt(await sign(k1, { ...base, exp: now - 60 }), opts)), null, 'small clock skew is tolerated');
  ok('wrong iss / aud, expired and empty sub are rejected');

  fetches = 0;
  const t2 = await sign(k2, base);
  assert.equal(await errOf(O.verifyJwt(t2, opts)), 'unauthorized');
  assert.equal(fetches, 2, 'an unknown kid refetches once');
  published = [k1.jwk, k2.jwk];
  assert.equal((await O.verifyJwt(t2, opts)).sub, 'g-123');
  ok('an unknown kid refetches the keys once (rotation)');
}

// ---- signInOrLink against D1
const { env, dispose } = await getPlatformProxy({ persist: { path: join(tmp, 'state') } });
const db = env.DB;
try {
  for (const f of readdirSync('migrations').sort()) {
    const sql = readFileSync(join('migrations', f), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt.replace(/\s+/g, ' ')).run();
  }
  let n = 0;
  const player = async (status = 0) => {
    const id = `p${++n}`;
    await db.prepare('INSERT INTO players (id, tag, created_at, last_seen_at, status) VALUES (?1, ?2, 0, 0, ?3)').bind(id, `T${n}`, status).run();
    return { id, tag: `T${n}`, status, pub: null, tokenHash: 'x' };
  };
  const device = { platform: 'android', appVersion: '1.0.0' };
  const sessionsOf = async (id) => (await db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE player_id = ?1').bind(id).first()).c;
  const go = (caller, provider, subject, now = 1000) => I.signInOrLink(env, caller, provider, { subject }, device, now);

  const a = await player();
  const r1 = await go(a, 'google', 'g-A');
  assert.deepEqual(r1, { result: 'linked', provider: 'google', linkedAt: 1000 });
  const r2 = await go(a, 'google', 'g-A', 2000);
  assert.deepEqual(r2, { result: 'linked', provider: 'google', linkedAt: 1000 });
  assert.equal(await sessionsOf(a.id), 0, 'linking issues no session');
  ok('links to the caller; linking again is a no-op');

  const r3 = await go(null, 'google', 'g-A');
  assert.equal(r3.result, 'signedIn');
  assert.equal(r3.auth.playerId, a.id);
  assert.match(r3.auth.token, /^hr1\./);
  assert.equal(await sessionsOf(a.id), 1);
  const via = await db.prepare('SELECT via FROM sessions WHERE player_id = ?1').bind(a.id).first();
  assert.equal(via.via, 'google');
  const b = await player();
  const r4 = await go(b, 'google', 'g-A');
  assert.equal(r4.result, 'signedIn');
  assert.equal(r4.auth.playerId, a.id, 'another guest signs into the linked account, it is not re-linked');
  ok('a linked provider account signs any device into its player');

  assert.equal(await errOf(go(null, 'google', 'g-unknown')), 'not_found');
  ok('an unlinked provider account without a caller is a 404 (no player is created)');

  assert.equal(await errOf(go(a, 'google', 'g-A2')), 'identity_conflict');
  assert.deepEqual(await go(a, 'play_games', 'pg-A'), { result: 'linked', provider: 'play_games', linkedAt: 1000 });
  assert.deepEqual(await go(a, 'google', 'g-A', 3000), { result: 'linked', provider: 'google', linkedAt: 1000 });
  ok('one account per provider per player; other providers still link');

  await I.unlink(env, a.id, 'google');
  assert.equal(await errOf(go(null, 'google', 'g-A')), 'not_found');
  assert.equal((await go(a, 'google', 'g-A2')).result, 'linked');
  ok('unlink frees the provider slot and the old provider account');

  const d = await player(2);
  await db.prepare("INSERT INTO identities (provider, subject, player_id, created_at) VALUES ('apple', 'ap-D', ?1, 0)").bind(d.id).run();
  assert.equal(await errOf(go(null, 'apple', 'ap-D')), 'unauthorized');
  assert.equal(await sessionsOf(d.id), 0);
  ok('a disabled player cannot be signed into');

  assert.equal(await errOf(Promise.resolve().then(() => I.parseProvider('email'))), 'not_found');
  assert.equal(I.parseProvider(['play_games']), 'play_games');
  ok('only google / apple / play_games are routable');
} finally {
  await dispose();
  rmSync(tmp, { recursive: true, force: true });
}
