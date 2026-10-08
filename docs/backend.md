# Hanzi Rush backend: guest accounts, cloud save, leaderboards

Status: design, ready to implement. Contract: [`shared/api.ts`](../shared/api.ts), which already exists and type-checks.
Scope: a solo dev's game running on the Cloudflare free tier. The rule is local-first: the game must keep working offline, and the backend only adds to it.

---

## 1. Architecture

**Choice: Cloudflare Pages Functions (`functions/`) + one D1 database, deployed with the existing Pages project.**

Why Pages Functions rather than a separate Worker:

| Concern | Pages Functions | Separate Worker |
| --- | --- | --- |
| Deploy | `wrangler pages deploy` ships the static site and the API together, atomically | two deploys and two configs |
| Web origin | same origin (`/api/v1/*`), so the web build needs no CORS and no absolute URL | always cross-origin |
| Preview deploys | every branch preview gets its own API automatically | manual |
| Static asset cost | Pages generates `_routes.json` that only invokes functions for `/api/*`. Assets stay free and unmetered | n/a |
| Cron triggers | **not available** | available |
| Rate-limit binding | not relied on | available |

We need neither of the two Worker-only features:
- **Pruning** old daily/weekly rows and runs happens opportunistically, in `waitUntil` on about 1 in 100 submissions (§5.6).
- **Rate limiting** uses data we already store (timestamps on `saves` and `runs`). Only the two unauthenticated endpoints (create and recover) write a counter row (§6.4). If the site gets a custom domain later, add one free WAF rate-limit rule on `/api/*` as an outer shield.

If cron or Durable Objects are needed later, `server/` is plain TS and can be moved behind a Worker without changes.

Free-tier budget: 100k function invocations/day; D1 has 5M rows read/day, 100k rows written/day and 5 GB. One run costs about 1 ticket insert + 1 run update + ≤3 score upserts, so 5 writes. That covers about 15k runs/day before hitting the limit.

### File layout

```
shared/
  api.ts                         # DONE: types, constants, checkRun(), periodKeys(), sanitizeName()  (both sides import)
migrations/
  0001_init.sql                  # WP-A: copy §3 verbatim
functions/                       # WP-A: Pages file-based routes only (thin handlers)
  tsconfig.json                  #   types: @cloudflare/workers-types; include ../functions ../server ../shared
  api/
    [[path]].ts                  #   404 JSON for unknown /api/* (stops the SPA fallback returning index.html)
    v1/
      _middleware.ts             #   CORS + preflight, error → JSON, body-size guard, request timing
      health.ts                  #   GET
      players.ts                 #   POST
      me.ts                      #   GET, DELETE
      me/recovery-code.ts        #   POST
      recover.ts                 #   POST
      save.ts                    #   GET, PUT
      runs/index.ts              #   POST (submit)
      runs/start.ts              #   POST
      boards/[board].ts          #   GET
server/                          # WP-A: logic (kept out of functions/ so no file becomes a route by accident)
  env.ts                         #   interface Env { DB: D1Database; ALLOWED_ORIGINS: string; IP_SALT: string }
  http.ts                        #   json(), fail(code, msg, extra), readJson(req, maxBytes), class ApiError
  cors.ts                        #   allowlist + headers
  crypto.ts                      #   randomToken(), sha256Hex(), randomCode(alphabet, n), uuid()
  auth.ts                        #   authenticate(ctx, required) → Player | null; issueSession()
  validate.ts                    #   validateSaveDoc(), validateSubmit()
  ratelimit.ts                   #   ipLimit(), per-player interval checks
  boards.ts                      #   upsertScores(), rankOf(), top()
  prune.ts                       #   maybePrune()

src/                             # WP-B
  core/storage.ts                #   NEW shim (see §7.0). Replaced by the feat/capacitor version at merge
  core/api.ts                    #   NEW fetch wrapper: base URL, auth header, timeout, ApiError
  core/cloud.ts                  #   NEW sync engine + public API (§7.2)
  core/merge.ts                  #   NEW pure 3-way merge (§5.3)
  core/merge.test.ts             #   NEW vitest unit tests for merge (recommended)
  core/store.ts                  #   CHANGED: types from shared, onSave(), snapshot(), replaceAll(), freshSave()
  core/i18n.ts                   #   CHANGED: new keys (§8.4)
  vite-env.d.ts                  #   NEW: ImportMetaEnv { VITE_API_BASE?: string }
  main.ts                        #   CHANGED: one line, see §7.1 (moves to src/boot.ts after the capacitor merge)
  games/quiz/QuizGame.ts         #   CHANGED: run handle at start(), durationMs/runId at finish(), dev checkRun
  games/registry.ts              #   CHANGED: `export type { Mode } from '../../shared/api'`
  screens/results.ts             #   CHANGED: RunStats fields, submitRun, rank chip, trophy button
  screens/levels.ts              #   CHANGED: trophy button in topbar
  screens/leaderboard.ts         #   NEW screen
  screens/home.ts                #   CHANGED: refresh chip on cloud 'applied'
  games/gacha/profile.ts         #   CHANGED: cloud card (status, transfer code, restore); sanitizeName
  ui/transfer.ts                 #   NEW modals: show code / enter code / merge choice
  ui/widgets.ts                  #   CHANGED: ICON.trophy, ICON.cloud
  style.css                      #   CHANGED: .lb-* styles
  games/gacha/vault.css          #   CHANGED: .pf-cloud* styles
tsconfig.json                    # CHANGED: "include": ["src", "shared"]
vite.config.ts                   # CHANGED: dev proxy /api → 127.0.0.1:8788
wrangler.toml                    # CHANGED: D1 binding + vars (§9)
package.json                     # CHANGED: scripts + devDeps wrangler, @cloudflare/workers-types, vitest
```

Ownership: WP-A owns `functions/`, `server/`, `migrations/`, `wrangler.toml`, `functions/tsconfig.json`. WP-B owns everything in `src/`, plus `vite.config.ts`, root `tsconfig.json` and `package.json` scripts (A sends its script lines to B; see §10). **Neither side edits `shared/api.ts` without telling the other.**

---

## 2. Identity model

- **Player** = one account (UUID v4, server-generated). It has a public 4-char `tag` (for "Player#7KQ2"), plus `name` and `title` copied from the save/runs for leaderboard display.
- **Session** = one device login. The token is `hr1.` + 32 random bytes base64url. The server stores only `sha256(token)`. A player can have many sessions (one per device). Tokens don't expire; deleting the row revokes one.
- **Recovery (transfer) code**: 12 chars from `RECOVERY_ALPHABET`, 60 bits, shown as `XXXX-XXXX-XXXX`. The server stores only `sha256(code)`. Calling `POST /me/recovery-code` rotates it, and the old code dies. The client caches the plain code locally so the profile can show it again. Redeeming does **not** consume the code and does not revoke other sessions. That fits a transfer flow where the old phone may be lost or kept. Brute force is impractical: 60 bits against 10 tries/hour/IP.
- **Identities** (future Apple/Google/email): the row `(provider, subject) → player_id`. Linking later means: an authenticated player calls `POST /me/identities/{provider}` with the provider token and the server inserts a row. Signing in on a new device means `POST /auth/{provider}`, which finds the row and issues a session. These are not built now; the table and `MeResponse.identities` exist so nothing needs to migrate.
- **Delete**: `DELETE /me` cascades everything. This is needed for App Store guideline 5.1.1(v) once the Capacitor app ships.

---

## 3. D1 schema: `migrations/0001_init.sql` (+ `0002_push_ids.sql`)

`0002_push_ids.sql` adds `saves.push_ids TEXT NOT NULL DEFAULT '[]'`: a JSON array with the ids of the last 16 accepted `PUT /save` (oldest first), see §5.4.

All timestamps are epoch milliseconds (INTEGER).

```sql
-- 0001_init.sql: Hanzi Rush backend
-- players: one row per account (guest or linked)
CREATE TABLE players (
  id                  TEXT PRIMARY KEY,               -- uuid v4
  tag                 TEXT NOT NULL,                  -- 4 chars of RECOVERY_ALPHABET, public, not unique
  name                TEXT NOT NULL DEFAULT '',       -- sanitizeName()
  title               TEXT NOT NULL DEFAULT 'novice', -- sanitizeTitle()
  created_at          INTEGER NOT NULL,
  last_seen_at        INTEGER NOT NULL,
  recovery_hash       TEXT,                           -- sha256 hex of normalized code
  recovery_created_at INTEGER,
  status              INTEGER NOT NULL DEFAULT 0,     -- 0 ok, 1 hidden from boards (shadow ban), 2 disabled (403 banned)
  created_ip_hash     TEXT                            -- sha256(IP_SALT + ip), for abuse forensics only
);
CREATE UNIQUE INDEX players_recovery ON players(recovery_hash) WHERE recovery_hash IS NOT NULL;

-- sessions: device logins; token never stored in clear
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,                       -- sha256 hex of the bearer token
  player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  via          TEXT NOT NULL,                          -- 'guest' | 'recovery' | 'apple' | 'google' | 'email'
  platform     TEXT,                                   -- 'web' | 'ios' | 'android'
  app_version  TEXT
);
CREATE INDEX sessions_player ON sessions(player_id);

-- identities: future third-party sign-in links (unused until sign-in ships)
CREATE TABLE identities (
  provider   TEXT NOT NULL,                            -- 'apple' | 'google' | 'email'
  subject    TEXT NOT NULL,                            -- provider's stable user id / lowercased email
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  email      TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_player ON identities(player_id);

-- saves: one opaque SaveDoc JSON per player, compare-and-swap on revision
CREATE TABLE saves (
  player_id         TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  revision          INTEGER NOT NULL,
  format            INTEGER NOT NULL,                  -- SAVE_FORMAT
  data              TEXT NOT NULL,
  bytes             INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  client_updated_at INTEGER
  -- push_ids TEXT NOT NULL DEFAULT '[]'  (added by 0002_push_ids.sql, see §5.4)
);

-- runs: tickets + submissions (audit log, idempotency, rate limiting)
CREATE TABLE runs (
  id            TEXT PRIMARY KEY,                      -- ticket (random 128-bit, base64url) or uuid for ticketless
  player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  board         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,                      -- ticket issue time (verified) or submit time (ticketless)
  client_run_id TEXT,                                  -- set on submit
  submitted_at  INTEGER,
  score         INTEGER,
  correct       INTEGER,
  asked         INTEGER,
  max_combo     INTEGER,
  duration_ms   INTEGER,
  verified      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'open',          -- 'open' | 'ok' | 'rejected'
  reason        TEXT                                   -- checkRun() reason when rejected
);
CREATE INDEX runs_player_time ON runs(player_id, created_at);
CREATE UNIQUE INDEX runs_client ON runs(player_id, client_run_id) WHERE client_run_id IS NOT NULL;
CREATE INDEX runs_prune ON runs(created_at);

-- scores: best per (board, period, player). period = 'all' | 'dYYYY-MM-DD' | 'wYYYY-MM-DD'
CREATE TABLE scores (
  board       TEXT NOT NULL,
  period      TEXT NOT NULL,
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  achieved_at INTEGER NOT NULL,
  run_id      TEXT NOT NULL,
  verified    INTEGER NOT NULL,
  PRIMARY KEY (board, period, player_id)
);
CREATE INDEX scores_rank ON scores(board, period, score DESC, achieved_at ASC);
CREATE INDEX scores_period ON scores(period);

-- rate_limits: fixed-window counters for unauthenticated endpoints only
CREATE TABLE rate_limits (
  key    TEXT NOT NULL,                                -- 'create:<iphash>' | 'recover:<iphash>'
  bucket INTEGER NOT NULL,                             -- floor(now / 3600000)
  count  INTEGER NOT NULL,
  PRIMARY KEY (key, bucket)
);
```

Notes:
- **Shadow ban** (`status=1`): delete the player's `scores` rows. Later submissions return the normal 200 response but skip the upsert. Because banned rows never exist, rank and total queries need no join. Only the top-N query joins `players` to fetch names.
- D1 enforces foreign keys, so `ON DELETE CASCADE` makes `DELETE FROM players WHERE id=?` a full account deletion.

---

## 4. HTTP API

Base: `${VITE_API_BASE}/api/v1` (`API_PREFIX`). All bodies are JSON (`Content-Type: application/json`). Every response includes `Cache-Control: no-store` except `GET /boards` (see below).
Auth: `Authorization: Bearer <token>` (`AUTH_HEADER`, `authValue()`). All request/response types are in `shared/api.ts`.

| Method & path | Auth | Request | 2xx response | Errors |
| --- | --- | --- | --- | --- |
| `GET /health` | – | – | `{ ok: true, time: number }` | – |
| `POST /players` | – | `CreatePlayerRequest` | 201 `CreatePlayerResponse` (`save: null`) | 400, 429 (30/h/IP) |
| `GET /me` | required | – | `MeResponse` (`recoveryCreatedAt`: when the current transfer code was made, null = none) | 401, 403 `banned` |
| `DELETE /me` | required | – | 204 | 401 |
| `POST /me/recovery-code` | required | `RecoveryCodeRequest` (`{}` or `{ signOutOthers: true }`) | `RecoveryCodeResponse` (rotates; `signOutOthers` also deletes every other session of the player) | 401, 429 (≥10 s between calls) |
| `POST /recover` | – | `RecoverRequest` | `RecoverResponse` (new session for that player; `save` meta and `recoveryCreatedAt` included) | 400 (malformed code), 401 (unknown code), 429 (10/h/IP, failed **and** successful attempts count) |
| `GET /save` | required | – | `SaveResponse` (+ `pushIds`) | 401, 404 `not_found` (never uploaded) |
| `PUT /save` | required | `PutSaveRequest` (≤ 512 KiB, optional `pushId`) | `PutSaveResponse` | 400 / `unsupported_version` (`data.v` ≠ 1), 401, 409 `SaveConflictBody`, 413, 429 (≥10 s since `saves.updated_at`) |
| `POST /runs/start` | required | `StartRunRequest` | `StartRunResponse` | 400 (bad board), 401, 429 (≥2 s since the player's last run row; ≤500 rows per board-day) |
| `POST /runs` | required | `SubmitRunRequest` | `SubmitRunResponse` | 400 / `unsupported_version` (scoring), 401, 422 `implausible` (+`reason`), 422 `ticket_invalid`, 429 (>30 unverified per day) |
| `GET /boards/:board?period=&limit=` | optional | `BoardQuery` | `BoardResponse` | 400 (bad board/period/limit) |
| anything else under `/api/` | – | – | – | 404 `not_found` JSON |

Error body is always `ApiErrorBody`: `{ "error": { "code", "message", "retryAfter"?, "reason"? } }`, with HTTP status from `STATUS[code]`. 429 also sets a `Retry-After` header.

### Endpoint semantics

**POST /players**
1. Check `ipLimit('create', 30/h)` (`LIMITS.createPerIpPerHour`; shared NATs such as schools and mobile carriers exceed 5). The client also skips account creation for a first-time visitor who has not played.
2. Create `id = crypto.randomUUID()` and a random `tag`.
3. Issue a session with `via='guest'`.
4. Write both in one `db.batch`.

**Authentication** (`server/auth.ts`):
1. Parse `Bearer hr1.…`.
2. `SELECT s.player_id, p.status, p.tag … FROM sessions s JOIN players p … WHERE s.token_hash=?`.
3. Return 401 if the row is missing, and **403 `banned`** if `status=2` (so the client can stop instead of minting a fresh guest). With optional auth (`GET /boards`) a banned token is treated as anonymous.
4. In `waitUntil`: `UPDATE sessions SET last_used_at=?1 WHERE token_hash=?2 AND last_used_at < ?1 - 86400000`, and do the same for `players.last_seen_at`. That costs at most one write per device per day.

**PUT /save** (compare-and-swap; the server never merges):
1. Read the body with a 512 KiB cap (`Content-Length` first, then actual bytes). Over the cap → 413.
2. Run `validateSaveDoc` (shape only: top-level keys and types). Every number must be finite, an integer and in `0..1e9`, except `cards[k][2]` (first-pulled epoch **seconds**, ~1.8e9), which is capped at `1e10`. Caps: `best` ≤ 200 keys, `words` ≤ 6000 keys, `cards` ≤ 6000 keys, `profile.seen` ≤ 64. Strings must be bounded. Unknown extra keys are allowed for forward compatibility.
3. Rate check: if `now - saves.updated_at < 10 s`, return 429.
3a. Optional `pushId` (must match `^[A-Za-z0-9_-]{8,64}$`, else 400). `ids = JSON.stringify([...saves.push_ids, pushId].slice(-16))` is written together with the data in both the UPDATE and the INSERT. `GET /save` and the 409 `current` return it as `pushIds`.
4. Write:
   - If `baseRevision == 0`: `INSERT INTO saves … VALUES (…, revision=1) ON CONFLICT(player_id) DO NOTHING`.
   - Otherwise: `UPDATE saves SET data=?, revision=revision+1, … WHERE player_id=? AND revision=?baseRevision`.
5. If `meta.changes == 0`, re-read and return 409 with `current`.
6. Otherwise, in the same batch: `UPDATE players SET name=?, title=?` from `sanitizeName(data.progress.profile.name)` / `sanitizeTitle(...)`.

**POST /runs/start**:
1. Validate the board with `parseBoardKey`.
2. Check the interval and daily limits (§6.4).
3. Insert `runs(id=ticket, status='open', created_at=now)`.
4. Return the ticket. `expiresAt = now + 6 h`.

**POST /runs** (in order):
1. Check `scoring ∈ SUPPORTED_SCORING`, otherwise `unsupported_version`.
2. **Idempotency**: if `runs` has `(player_id, client_run_id)` with `status='ok'`, recompute ranks and return 200 with the same shape. If it is `rejected`, return the same 422.
3. Run `checkRun(body)`. On failure, record the run as `rejected` with its reason and return 422 `implausible`.
4. If `ticket` is non-null, load the run row. It must exist, belong to this player, have `board` equal to `body.board`, have `status='open'` and have `now - created_at ≤ 6 h`. Otherwise return 422 `ticket_invalid`. If the server-measured `now - created_at` is below `minDurationMs(game, asked) × 0.8` the ticket arrived late (slow network at run start), which is not proof of cheating: the run is **not rejected**. The ticket is still claimed (`status='ok'`, so it cannot be reused) but with `verified=0`, and the period time is `t = now`. Otherwise mark the row `ok` with `verified=1`; the period time is then `t = created_at`, so a run started before midnight counts for the day it started. The `scores` upserts of this path are guarded with `AND EXISTS (SELECT 1 FROM runs WHERE id = ?ticket AND client_run_id = ?clientRunId)` so a request that lost the ticket race cannot leave a score behind.
5. If `ticket` is null, enforce ≤ 30 unverified rows per player per board-day, and `asked ≤ 300` (`SCORING.maxAskedUnticketed`; `checkRun(run, ticketed)` takes the flag so both sides agree). Insert a row with `id=uuid`, `verified=0`. Period time is `t = now`.
6. Sanitize `profile` if present and `UPDATE players` (name/title).
7. If `players.status=0`, upsert into `scores` for the periods `'all'`, `periodKeys(t).week` and `periodKeys(t).day` (§5.6). Use one `db.batch` for steps 4–7.
8. Compute `RankInfo` for each period and return it. `improved` comes from comparing against the pre-upsert best (read before the batch).

The client never gets a 422 for unverified (ticketless) runs if they are plausible. They rank like the others. `scores.verified` is stored so they can be filtered later if abuse appears.

**GET /boards/:board**:
- `period` defaults to `all`. `limit` defaults to 50, maximum 100.
- Every entry (and `me`) carries `verified` (`scores.verified`): false = unverified run, clients show a small mark.
- Response headers: `Vary: Authorization`; `Cache-Control: public, max-age=20` when unauthenticated, `private, max-age=5` when authenticated. The shared part (top rows + `total`) is kept in `caches.default` for 20 s per board/period/limit and served to everyone, signed in or not (`server/boardRoute.ts`); only the caller's own row (`me`) is a per-request query, and `isMe` is set by matching `pid`. So the top rows may lag a fresh run by up to 20 s, `me` never does, and `total` is never below `me.rank`. The post-run `ranks[*].total` comes from the same kind of 20 s cache.

Top N:

```sql
SELECT s.score, s.achieved_at, s.player_id, s.verified, p.name, p.tag, p.title
FROM scores s JOIN players p ON p.id = s.player_id
WHERE s.board = ?1 AND s.period = ?2
ORDER BY s.score DESC, s.achieved_at ASC
LIMIT ?3;
```

Competition ranking: equal scores share a rank only if `achieved_at` is equal too. The tie-breaker is earlier achieved first, so `rank = index + 1`. Total: `SELECT COUNT(*) FROM scores WHERE board=?1 AND period=?2`.

`me` (if authenticated): read the player's row, then

```sql
SELECT COUNT(*) + 1 FROM scores
WHERE board=?1 AND period=?2 AND (score > ?3 OR (score = ?3 AND achieved_at < ?4));
```

These are range scans on `scores_rank`. Rows read ≈ the player's rank, which is fine at this scale.

### CORS (`server/cors.ts`, applied in `_middleware.ts`)

- Allowed origins: the exact strings in `env.ALLOWED_ORIGINS` (comma-separated) plus the regex `^https://([a-z0-9-]+\.)?hanzi-rush\.pages\.dev$` (production and branch previews). Defaults in `wrangler.toml`:
  `capacitor://localhost` (iOS, app id `app.zeze.hanzirush`), `https://localhost` (Android), `http://localhost`, `http://localhost:5173`, `http://127.0.0.1:5173`, and the production custom domain when one exists.
- If the request's `Origin` is allowed, echo it: `Access-Control-Allow-Origin: <origin>` with `Vary: Origin`. Never use `*`, and never send `Allow-Credentials` (no cookies; auth is a header).
- Preflight `OPTIONS` → 204 with `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`, `Access-Control-Allow-Headers: Authorization, Content-Type`, `Access-Control-Max-Age: 86400`.
- Requests with a disallowed or missing `Origin` are still served without CORS headers. Same-origin web requests and native HTTP clients work, and browsers block cross-origin reads. CORS is not a security boundary here; the bearer token is.

---

## 5. Cloud save and conflict resolution

### 5.1 Why not last-write-wins

The game is played offline on more than one device. With LWW, a gacha session on device A plus an earning session on device B would lose one device's entire session: cards pulled on A vanish if B writes last. Most fields are counters (coins, xp, stats, word stats, card copies) or monotonic values (best, bestCombo), so we can merge them **exactly** if we know the common ancestor. The server already has a revision, so the client keeps the ancestor and does a **3-way merge**, the same model as git. The server stays a dumb compare-and-swap store. The merge lives in one pure function, so it is easy to unit-test.

### 5.2 Client sync state (persisted via `storage`, key `hanzi-rush:cloud:v1`)

```ts
interface CloudState {
  auth: { playerId: string; token: string; tag: string } | null;
  rev: number;                  // server revision that `base` corresponds to (0 = nothing on server)
  base: SaveDoc | null;         // last snapshot both sides agreed on (null → use freshSave() as base)
  inflight: { id: string; baseRev: number; doc: SaveDoc } | null; // the PUT whose reply we may have lost (§5.4)
  disabled: boolean;            // cloud save switched off (account deleted / banned)
  signedOut: boolean;           // the server revoked this device's session (401 confirmed by GET /me)
  signedOutSeen: boolean;       // the one-time "signed out" modal was shown for this sign-out
  syncedAt: number;             // last successful sync (UI "synced 2m ago")
  recovery: { code: string; createdAt: number } | null; // cached transfer code + the recovery_created_at it belongs to
  queue: QueuedRun[];           // offline run submissions (§7.4)
}
```

### 5.3 `merge(B, L, S): SaveDoc` (`src/core/merge.ts`)

B = base, L = local (current store), S = server. If B is null, use `freshSave()` as B. `Δ(x) = L.x − B.x` (missing → 0). `changed(x) = JSON(L.x) !== JSON(B.x)`.

| Field(s) | Rule | Result |
| --- | --- | --- |
| `coins`, `xp`, `stats.games/questions/correct/perfect/pulls/coinsEarned/coinsSpent`, `stats.byRarity[i]`, `daily.total` | additive | `max(0, S + Δ)` |
| `words[w] = [seen, correct]` (key union) | additive per component | `seen = max(0, S.seen + Δseen)`, `correct = min(seen, max(0, S.correct + Δcorrect))` |
| `cards[k] = [copies, rarity, first]` (key union, keys are never removed) | copies additive, rarity from either (deterministic per level, `gacha.ts:60,92`), first = min of non-zero | `[max(1, S.c + Δc), S.r ?? L.r, min(S.f, L.f)]` |
| `best[k]`, `stats.bestCombo`, `daily.best` | monotonic | `max(S, L)` |
| `stats.maxCoins` | monotonic | `max(S, L, merged.coins)` |
| `profile.seen` | set | union (keep S order, append new) |
| `daily.last` + `daily.streak` | as a pair | take the pair whose `last` is later (string compare); if equal, `max(streak)`. Then `daily.best = max(S.best, L.best, streak)` |
| `profile.name`, `profile.title`, `pity`, each `settings.*` | LWW-if-changed | `changed(L.x) ? L.x : S.x` (local wins ties: the user is looking at this device) |
| unknown keys (forward compat) | LWW-if-changed | same as above |

Properties:
- The merge is exact when edits are disjoint.
- Counters sum correctly when both sides changed them.
- If both devices spent the same coins offline, `coins` is clamped at 0 and the player keeps both sets of cards. That is an acceptable leak: coins only buy cosmetics, and leaderboards don't read the save.

`merge(B, L, L)` must equal L, and `merge(B, B, S)` must equal S. Test both, plus a "both spent" case and a "B = fresh" case.

### 5.4 Sync algorithm (`cloud.ts`; single-flight: one sync at a time via a promise chain)

```
sync():
  if !auth: ensureAccount() (POST /players; on failure stay offline) → return if still none
  local = store.snapshot()
  if rev == 0 or a pull is due (app launch, resume after >5 min hidden, after 409):
      GET /save
        404  → server has nothing → goto PUSH (baseRevision 0)
        200 S:
          if S.revision == rev → nothing new
          else if runActive → stash S as pendingServer; return (apply after the run, §7.3)
          else M = merge(base, local, S.data)
               store.replaceAll(M); base = S.data; rev = S.revision; persist; emit 'applied' if M != local
  PUSH:
  json = JSON(store.snapshot())
  if json == JSON(base) and rev > 0 → done
  inflight = { id: uuid, baseRev: rev, doc: data }; persist            // BEFORE the request
  PUT /save {baseRevision: rev, data, clientUpdatedAt, pushId: inflight.id}   (30 s timeout)
    200 → base = data; rev = res.revision; inflight = null; syncedAt = now; persist
    409 → S = body.current (null → treat like 404: rev = 0, base = null, retry); reconcile(S);
          M = merge(base, local, S.data); store.replaceAll(M); base = S.data; rev = S.revision;
          persist; retry PUSH once (a loop of at most 3 attempts)
    429 → schedule retry after retryAfter
    401 → GET /me once to confirm; if still 401 → status 'signedOut' (auth = null, rev = 0, base = null, `signedOut = true`; persisted).
          NO replacement guest is created: the device had an account, so silently forking onto a new one would orphan
          the player's real save. Local progress is kept; sync, tickets and run submits stop (like `disabled`). The UI
          shows a one-time modal (and a persistent note in the profile cloud card) with [Enter code] (the restore flow,
          §5.5) and [New cloud save] (`cloud.enable()`: new guest, local progress uploaded). A device that never had an
          account is unaffected: it still creates its guest lazily on first need. Banned (403) is `disabled`, as before.
          Never wipe local progress because of a server response.
    network error / 5xx → status 'offline', retry with backoff (15 s, 30 s, 60 s … max 5 min) and on 'online' event
```

**Lost replies (`reconcile(S)`).** If a PUT lands but its 200 never reaches the client, the next pull would merge our own push back into our data and double every additive field (coins, xp, stats, word stats, card copies). So the client remembers the attempt (`inflight`) and the server remembers the last 16 accepted `pushId`s. Whenever a server copy `S` is seen (top of `applyServer`, and in the pull phase before the `S.revision === rev` shortcut), `reconcile(S)` runs first:
- `S.pushIds` contains `inflight.id` → the push landed: `base = inflight.doc`, `inflight = null` (the merge that follows then sees base == S.data and keeps local).
- else if `S.revision > inflight.baseRev` → it did not land (or aged out): `inflight = null`.
A sync that starts with an unresolved `inflight` always pulls first. `inflight` is cleared wherever `base` is reset (new guest, 401, pull 404, recover, delete).

**Status.** `CloudStatus = 'off' | 'disabled' | 'signedOut' | 'offline' | 'syncing' | 'pending' | 'synced' | 'error'`. `synced` is only reported when the save is on the server and no queued run is waiting; a deferred push (10 s interval, run in progress) or a stuck run queue gives `pending`. `off` = no backend configured; `disabled` = the player deleted the account (or the server answered 403 `banned`): nothing talks to the server until `cloud.enable()` or a successful restore, boards stay readable anonymously. `signedOut` = the session was revoked (§5.2): nothing talks to the server until a successful restore or `cloud.enable()`; boards are read anonymously (no "me" row, no "finish a run to get ranked" hint) and the client's board cache is cleared whenever the account behind it changes.

**Hidden page.** On `visibilitychange → hidden` the save is pushed first (keepalive only when the body is ≤ 60 KiB), the run queue is drained after it.

**New persisted client state.** Only `settings` and `progress` are carried by `store.snapshot()/replaceAll()`, `merge()` and the cloud save. Top-level `SaveDoc` keys are not carried by the store and would be silently lost on the next merge: a new persisted field belongs **under `progress` or `settings`** (plus a rule in §5.3), or goes through `storage` as device-local state.

Invariant: `store.replaceAll(M)` and `base := S` are persisted together. Write the cloud state with `storage.set` right after `store.save()`. If the app dies in between, the worst case is one extra merge of the same delta. To make the double-apply window negligible, persist the cloud state **first** with `{base: S, rev}` and `pendingMerged: M`, then apply M to the store and clear `pendingMerged`. On boot, if `pendingMerged` exists, apply it.

### 5.5 Restoring on a new device (`cloud.recover(code)`)

1. `POST /recover` → new auth for the target player. Keep the old auth in memory until the restore completes.
2. `GET /save` → S (or 404 → nothing to restore; adopt the account and push local).
3. **Same account** (`auth.playerId == st.auth.playerId`, e.g. its own code typed in): no question, no Combine. Update the token and run the normal 3-way merge `merge(base ?? freshSave(), local, S.data)` (after `reconcile(S)`); a Combine against a fresh base would add the whole save to itself.
4. Otherwise, if local is "empty" (`stats.games == 0 && stats.pulls == 0 && xp == 0`), replace: `M = S.data`.
   Else ask the user (`ui/transfer.ts`, outside the sync chain, so an open dialog never stalls syncing) to **Combine** (`M = merge(freshSave(), local, S.data)`, which sums both devices' progress), **Use cloud only** (`M = S.data`) or **Cancel** (`recover` resolves `'cancelled'`, nothing changes). The code-entry modal is hidden while the choice modal is open (so it never stays stacked behind it showing "loading…"); Cancel brings it back with the typed code.
5. `replaceAll(M)`, `base = S.data`, `rev = S.revision`, `inflight = null`, `disabled = false`, `signedOut = false`, then push if M ≠ S.data.
5. The previous guest account on this device is orphaned. Its leaderboard rows stay; there is no server-side account merge in v1.

### 5.5a Transfer code cache

The client caches `{ code, createdAt }`. Showing the code first calls `GET /me`: the cache is only shown when `recoveryCreatedAt` equals the cached `createdAt`; a mismatch clears it and tells the player the code was replaced on another device. If the server has a code but this device never saw it, the code is **never rotated implicitly**: the player must tap "New code" (with a warning that the old code stops working and an optional "Sign out other devices", which sends `signOutOthers: true` and runs `DELETE FROM sessions WHERE player_id=? AND token_hash<>?`). An account with no code yet gets its first one automatically.

### 5.6 Leaderboard periods and pruning

- `periodKeys(t)` in shared: day/week keys in **UTC+7** (Thai audience), weeks start Monday. The client uses `resetsAt` for "resets in 5h".
- Upsert (three statements in one batch: all/week/day):
  ```sql
  INSERT INTO scores (board, period, player_id, score, achieved_at, run_id, verified)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  ON CONFLICT (board, period, player_id) DO UPDATE SET
    score = excluded.score, achieved_at = excluded.achieved_at,
    run_id = excluded.run_id, verified = excluded.verified
  WHERE excluded.score > scores.score;
  ```
- `maybePrune()` runs with probability 1/100 in `waitUntil` after a submit:
  - `DELETE FROM scores WHERE period >= 'd' AND period < 'd'||<today−3>`
  - `… period >= 'w' AND period < 'w'||<monday−14d>`
  - `DELETE FROM runs WHERE created_at < now−30d`
  - `DELETE FROM rate_limits WHERE bucket < currentBucket−2`
- Local `progress.best` is **never** sent to the leaderboard: it can be edited and predates the backend. Existing players appear on boards after their first run post-launch.

---

## 6. Anti-cheat (basic)

The aim is to stop casual tampering such as edited requests or a console `fetch` with score 9,999,999. It is not meant to stop a determined reverse-engineer: the client is fully trusted to play the game. All numbers come from `SCORING` in `shared/api.ts` and are enforced by `checkRun()` on both sides.

### 6.1 Facts derived from the code

| Fact | Source |
| --- | --- |
| Points per correct = `round((base + 100·frac) · mult · (fever ? 2 : 1) / 10) · 10` | `src/games/quiz/QuizGame.ts:418` |
| `base = 100 + (level−1)·20` → 100 (HSK1) … 200 (HSK6) | `QuizGame.ts:416`, levels 1–6 `src/core/data.ts:19-26` |
| `mult = 1 + min(combo, 40) · 0.05` → at most ×3.0 | `QuizGame.ts:417` |
| `frac = timeLeft/timeMax` in rush (≤ 1, since it is reset to timeMax at `:345`), **0 in practice** | `QuizGame.ts:415` |
| FEVER ×2 | `QuizGame.ts:418`, `:552-560` |
| Practice ends at exactly 20 asked | `QuizGame.ts:29`, `:319` |
| Rush has 3 lives, every wrong/timeout costs one, ends at 0 → exactly 3 wrong | `QuizGame.ts:92`, `:595`, `:682`, `:753-757` |
| Quit from pause sets phase over without `finish()`, so it never submits | `QuizGame.ts:194-198` |
| Cloze inherits all scoring (only timer +5 s) | `src/games/cloze/ClozeGame.ts:8`, `:51` |
| Ranked games: `quiz`, `cloze`; modes `rush`/`zen`; key format | `src/games/registry.ts:9`, `:30-31`, `:38` |
| Results only submit bests when `score > 0` | `src/screens/results.ts:44` |
| Countdown 3 × 560 ms + 420 ms = 2.1 s | `QuizGame.ts:264-282` |
| Quiz correct path ≥ 0.8 s explode delay + 0.2 s burst + 0.62 s flip ≈ 1.6 s/question; wrong path ≥ 0.25 + 0.65 s flip + tap + 0.62 s | `QuizGame.ts:481`, `:500-501`, `:376`, `:651-654` |
| Cloze: ≥ (0.05 + 0.35) s entrance wait + 0.46 s flight, victory lap skippable | `ClozeGame.ts:190`, `:278`, `:61`, `:87`, `:343` |
| Name max 16 | `src/games/gacha/profile.ts:36`, `:40` |

### 6.2 Rules in `checkRun()` (reason codes)

1. `board` parses and the game is ranked, level 1–6, mode rush|zen → `board`
2. All of `score, correct, asked, maxCombo, durationMs` are non-negative safe integers → `not_int`
3. `1 ≤ asked ≤ 2000` → `asked_range`; `correct ≤ asked` → `correct_gt_asked`; `maxCombo ≤ correct` → `combo_gt_correct`
4. Rush: `asked − correct == 3` → `rush_lives`. Practice: `asked == 20` → `zen_total`
5. `maxCombo ≥ ceil(correct / (wrong + 1))` (pigeonhole) → `combo_too_low`
6. `score % 10 == 0` → `score_rounding`
7. `score ≥ correct · base` (each correct pays ≥ round(1.05·base) ≥ base) → `score_too_low`
8. `score ≤ maxScore(level, rush, correct, maxCombo) = Σ_{i=1..correct} round((base + 100·rush) · (1 + 0.05·min(i, maxCombo, 40)) · 2 / 10) · 10` → `score_too_high`. This assumes FEVER on every answer and the full speed bonus, using the game's exact formula, so a legit run can never exceed it.
9. `durationMs ≥ 0.8 · (2100 + asked · minQ)`, with `minQ` = 1000 ms (quiz) / 600 ms (cloze) → `too_fast`
10. Without a ticket: `asked ≤ 300` (stricter than rule 3's 2000) → `asked_range`.
11. Server only, with a ticket: `serverNow − ticket.created_at ≥ 0.8 · (2100 + asked · minQ)`. This cannot be bypassed by editing `durationMs`, but failing it is **not a rejection**: the ticket may simply have arrived late. The run is accepted as `verified=0` (ticket claimed).

Concrete ceilings (verified by running `maxScore`):

| | HSK1 | HSK6 |
| --- | --- | --- |
| Practice, perfect 20/20 | 6,100 | 12,200 |
| Rush, best possible single answer (combo ≥ 40) | 1,200 | 1,800 |
| Rush, 50 correct with ×50 combo | 44,400 | — |
| Rush, minimum wall time for 50 asked (quiz) | 0.8 · (2.1 + 53·1.0) s ≈ 44 s | |

### 6.3 Payload and name rules

- Bodies are capped at 16 KiB, or 512 KiB for `PUT /save` (413). Check `Content-Length` and the actual bytes read.
- Names go through `sanitizeName()`: NFKC; strip `Cc/Cf/Co/Cs/Zl/Zp` (zero-width, bidi overrides); collapse whitespace; clamp combining-mark runs to 3 (Thai-safe); ≤ 16 code points. Titles must match `/^[a-z0-9_-]{1,24}$/`, else `'novice'`. The client renders unknown ids as novice through `titleById`.
- There is no profanity filter in v1. Use `players.status = 1` (shadow ban) manually via `wrangler d1 execute --remote` when needed.

### 6.4 Rate limits

| Endpoint | Limit | Mechanism (no extra writes unless noted) |
| --- | --- | --- |
| `POST /players` | 30 / hour / IP | `rate_limits` upsert `count = count + 1 … RETURNING count` (1 write) |
| `POST /recover` | 10 / hour / IP | same |
| `PUT /save` | ≥ 10 s apart / player | `saves.updated_at` |
| `POST /me/recovery-code` | ≥ 10 s apart / player | `players.recovery_created_at` |
| `POST /runs/start` | ≥ 2 s apart; ≤ 500 runs rows / player / board-day | `runs_player_time` index (`MAX(created_at)`, `COUNT(*)`) |
| `POST /runs` (ticketless) | ≤ 30 / player / board-day | `COUNT(*) … AND verified = 0` |
| all | best-effort per-isolate token bucket keyed by token hash or IP (60 req/min) | in-memory `Map`, no D1 cost |

IP hashing: `sha256(IP_SALT + CF-Connecting-IP)`. `IP_SALT` is a Pages secret.

---

## 7. Client integration (WP-B)

### 7.0 Persistence: `src/core/storage.ts` (shim)

The parallel `feat/capacitor` branch adds `src/core/storage.ts`, a synchronous get/set backed by an in-memory cache. It uses Capacitor Preferences on native and localStorage on web. **All new persisted client state goes through it, never `localStorage` directly.** On this branch, create a shim with the same name and API so the merge is a straight file replacement:

```ts
// src/core/storage.ts: shim; replaced by the feat/capacitor implementation at merge
export const storage = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, val: string): void {
    try { localStorage.setItem(key, val); } catch { /* private mode */ }
  },
};
```

`cloud.ts` stores `CloudState` under `hanzi-rush:cloud:v1` via `storage`. Leave `store.ts`'s own `localStorage` use alone; the capacitor branch owns that change. Only add the new store methods below.

### 7.1 Config and boot

- `src/core/api.ts`: `const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '') + API_PREFIX;`. An empty value means same-origin, which is the web default.
- Native builds must use an absolute URL, because a relative fetch from `capacitor://localhost` would hit the app bundle. `src/core/api.ts` defaults native builds to `https://hanzi-rush.zeze.app`; set `VITE_API_BASE` at build time to override it. `VITE_API_BASE=off` disables cloud entirely: `cloud.init()` becomes a no-op and the UI hides the cloud features.
- `src/vite-env.d.ts`: `interface ImportMetaEnv { readonly VITE_API_BASE?: string }`.
- **`main.ts`: the only change is** `import { cloud } from './core/cloud';` and `cloud.init();` right after `app.show(homeScreen())` (line 27). On `feat/capacitor`, `main.ts`'s body moved to `src/boot.ts`, so at merge these two lines go to the same spot in `boot.ts`. Make no other `main.ts` edits.
- `api.ts` details: 8 s `AbortController` timeout. Parse error bodies into `class ApiError { status; code; body }`; a network failure is `ApiError` with `status 0, code 'offline'`. Send `DeviceInfo` with `platform` `'web'` for now (the capacitor branch can detect native) and `appVersion` from `package.json` via `define`/`import.meta.env`.

### 7.2 `src/core/cloud.ts` public surface

```ts
export type CloudStatus = 'off' | 'disabled' | 'offline' | 'syncing' | 'pending' | 'synced' | 'error';
export interface RunHandle { id: string; board: BoardKey; startedAt: number /* performance.now() */ }

export const cloud: {
  init(): void;                                   // load CloudState, register store.onSave, 'online', visibilitychange; kick sync()
  readonly status: CloudStatus;
  readonly syncedAt: number;
  readonly tag: string | null;                    // for "Player#TAG"
  on(ev: 'status' | 'applied', cb: () => void): () => void;  // 'applied' = remote changes merged into store
  flush(opts?: { keepalive?: boolean }): Promise<void>;     // push now (respecting server interval)
  startRun(board: BoardKey): RunHandle;           // sync; fires POST /runs/start in background (ticket kept internally)
  submitRun(h: RunHandle, r: RunStats): Promise<SubmitRunResponse | null>; // enqueue + try; null if queued/offline/rejected
  board(board: BoardKey, period: Period, limit?: number): Promise<BoardResponse>; // throws ApiError (offline)
  recoveryState(): Promise<{ state: 'ok'; code: string } | { state: 'none' | 'replaced' | 'unknown' }>; // validated against GET /me (§5.5a)
  newRecoveryCode(signOutOthers?: boolean): Promise<string>; // always rotates; formatted XXXX-XXXX-XXXX
  recover(code: string, choose: () => Promise<'combine' | 'cloud' | 'cancel'>): Promise<'ok' | 'invalid' | 'offline' | 'rate_limited' | 'cancelled'>;
  deleteAccount(): Promise<void>;                 // DELETE /me, then clear CloudState and stay disabled (local progress kept)
  readonly disabled: boolean;
  readonly signedOutPending: boolean;             // signed out and not yet told (one-time modal)
  markSignedOutSeen(): void;
  enable(): Promise<void>;                        // clear `disabled`/`signedOut` (a NEW guest), sync
};
```

### 7.3 Hooks into existing code

- **`src/core/store.ts`**:
  - `import type { Settings, Progress, … } from '../../shared/api'` and re-export them (all existing importers keep working).
  - Add `export const freshSave = (): SaveDoc` from `defaults()`.
  - Add `store.onSave(cb)`. `save()` calls the listeners after writing.
  - Add `store.snapshot(): SaveDoc` (`structuredClone`, `v: 1`).
  - Add `store.replaceAll(doc)`, which mutates `state.settings`/`state.progress` **in place** (`Object.assign` after deleting keys), so `store.progress` keeps its identity, then calls `save()`.
- **Change debounce**: `onSave` → `cloud` marks dirty and schedules `sync()` in 15 s. It also forces a flush on the results screen (after `awardRun`/`submitBest`), on `visibilitychange → hidden` (`keepalive: true` only if the body is ≤ 60 KiB, `LIMITS.keepaliveMaxBytes`; otherwise a normal fetch) and on `online`.
- **`QuizGame.ts`**:
  - In `start()` (`:250`), set `this.run = cloud.startRun(bestKey(this.gid, level, mode))`.
  - In `finish()` (`:688-705`), add `runId: this.run.id, durationMs: Math.round(performance.now() - this.run.startedAt)` (monotonic clock, so a wall-clock change mid-run can't skew it) to `RunStats`.
  - In `import.meta.env.DEV`, `console.error` if `checkRun(...)` fails. That means `SCORING` drifted from the game.
- **`results.ts`**:
  - Extend `RunStats` with `runId?: string; durationMs?: number`.
  - After line 44: `if (r.score > 0 && handle) cloud.submitRun(handle, r).then(showRank)`. `showRank` adds a chip under the score (`.r-rank`: "🏆 #12 today", or "#3 all-time" when `ranks.all.improved`). It only does this if the screen is still mounted.
  - Add a trophy `iconButton` to the topbar (`:149`) → `leaderboardScreen({ board, from: 'results' })`.
  - Keep the handle on the cloud side keyed by `runId`, so `RunStats` stays serializable: `submitRun` looks up the handle by `r.runId`.
- **Run-active guard**: `startRun` sets `runActive = true`; `submitRun` and screen `leave` clear it. While a run is active, merges of pulled data are deferred (`pendingServer`). Pushes are still allowed because they don't touch the store.
- **`home.ts`**: subscribe to `cloud.on('applied')` to re-run `syncChip`, the coins and `syncStreak` (unsubscribe in `leave`).

### 7.4 Offline run queue

- `QueuedRun = { req: SubmitRunRequest; firstAt: number; tries: number }`, persisted in `CloudState.queue`.
- `submitRun`:
  1. Await the ticket promise, waiting at most 3 s.
  2. Build the request with `ticket ?? null`, `scoring: SCORING_VERSION`, `profile: {name, title}`.
  3. Run `checkRun` locally; don't send failures.
  4. POST. On network/5xx/429 → push to the queue (cap 20, drop oldest; drop entries older than 7 days). On 422/400 → drop and log. On 200 → resolve.
- The queue drains FIFO at the start of every `sync()` and on `online`. A run that can't be delivered **never blocks the save sync**: the drain stops at it (`tries++` unless the device is simply offline; dropped after 20 tries), a 429 asking for more than 300 s (the daily unverified cap) drops the run, and a 401 is rethrown so the account check (`handle401`) runs. While runs are stuck the status is `pending` and a backoff retry is scheduled. `clientRunId` makes retries idempotent.
- No auth yet (first launch offline) → queue. The queue drains once `ensureAccount()` succeeds.

---

## 8. Leaderboard and cloud UI

### 8.1 New screen `src/screens/leaderboard.ts`

`leaderboardScreen(opts: { board: BoardKey; period?: Period; from: 'levels' | 'results' }): Screen`. Theme `'results'`. It follows the existing screen pattern (`h()`, `tx()`, `pressable`, `gsap` enter animations, `i18n.onChange` re-render, `onKey` Escape → back).

Layout, top to bottom:
1. **topbar**: back `iconButton(ICON.back)` (to `levelsScreen(game)` or `homeScreen`), a game chip as in `levels.ts:27`, spacer, `muteButton()`, `langToggle()`.
2. **Mode segment**: reuse `.seg`/`.seg-opt`/`.seg-knob` from levels (Rush / Practice).
3. **Level pills** `HSK 1 … 6`: a horizontal row (`.lb-levels > button.lb-lv`) coloured with `LEVELS[i].color`.
4. **Period tabs** (`.lb-tabs`): All-time / This week / Today, with `resetsAt` shown as "resets in 5h".
5. **List** `.lb-list`: rows `.lb-row`:
   - rank, with medals for 1–3: gold `#ffc93c`, silver, bronze
   - seal glyph `titleById(title).zh[0]` with `data-t=tier`, reusing the `.pc-seal` look
   - name, or `${t('playerName')}#${tag}`, with `T[i18n.lang]` underneath
   - score `formatNum`
   - `isMe` rows get the `.me` highlight
6. **Sticky "me" row** `.lb-me` at the bottom when `me` isn't in the top N, or a "Play a run to get ranked" hint.
7. **States**: loading (`tx('loading')`), empty (`lbEmpty`), offline (`lbOffline` + tap to retry, like `loadFail` in levels).

Entries pop in with `popIn(rows, 0.1, 0.03)`. The fetch uses `cloud.board()` with a 30 s in-memory cache per (board, period).

### 8.2 Entry points

- `levels.ts` topbar: a trophy `iconButton(ICON.trophy, …)` → leaderboard for `(game, last opened level, current mode)`.
- `results.ts` topbar trophy, plus the rank chip (§7.3).
- `home.ts`: no new button (keeps the hero clean); the profile chip leads to the profile, which shows cloud status.

### 8.3 Profile cloud card (`src/games/gacha/profile.ts`, styles in `vault.css` under `.pf-cloud*`)

A new section after `stats` (before the titles header `:137`), titled `'云'` + `tx('cloudSave')`:
- Status line: `cloudSynced` + relative time / `cloudOffline` / `cloudSyncing`.
- Player id line: `#TAG`.
- **Transfer code** button → `ui/transfer.ts` modal (the `.modal`/`.modal-card` pattern from `ui/daily.ts`). It shows the large code `XXXX-XXXX-XXXX`, a copy button (`navigator.clipboard`, then `copied` toast), a "new code" link (rotate) and the `transferHint` text.
- **Restore** button → modal with an input (stop key propagation like `profile.ts:46`), then `restoreConfirm`. If local progress exists, show the Combine / Cloud only choice (`restoreCombine`, `restoreCloudOnly`).
- Name input change handler (`:39-43`): use `sanitizeName(name.value)` instead of `trim().slice(0,16)`.
- Hidden entirely when `cloud.status === 'off'`. When `disabled` (account deleted / banned) the card shows "Cloud save is off" with **Turn on cloud save** and **Restore**. The trophy buttons stay visible then (boards are public); they're only hidden for `off`.

### 8.4 i18n keys (add to `src/core/i18n.ts` dict)

```ts
leaderboard: { en: 'Leaderboard', th: 'กระดานผู้นำ' },
lbAll: { en: 'All-time', th: 'ตลอดกาล' },
lbWeek: { en: 'This week', th: 'สัปดาห์นี้' },
lbDay: { en: 'Today', th: 'วันนี้' },
lbResets: { en: 'Resets in', th: 'รีเซ็ตใน' },
lbYou: { en: 'You', th: 'คุณ' },
lbEmpty: { en: 'No scores yet. Be the first!', th: 'ยังไม่มีใครทำคะแนน เป็นคนแรกเลย!' },
lbUnranked: { en: 'Finish a run to get ranked', th: 'เล่นจบหนึ่งรอบเพื่อติดอันดับ' },
lbOffline: { en: 'Offline. Tap to retry.', th: 'ออฟไลน์อยู่ แตะเพื่อลองใหม่' },
lbRankDay: { en: 'today', th: 'วันนี้' },
lbRankAll: { en: 'all-time', th: 'ตลอดกาล' },
cloudSave: { en: 'Cloud save', th: 'เซฟบนคลาวด์' },
cloudSynced: { en: 'Synced', th: 'ซิงก์แล้ว' },
cloudSyncing: { en: 'Syncing…', th: 'กำลังซิงก์…' },
cloudOffline: { en: 'Offline. Will sync later.', th: 'ออฟไลน์ จะซิงก์ให้ทีหลัง' },
transferCode: { en: 'Transfer code', th: 'รหัสย้ายเครื่อง' },
transferHint: { en: 'Enter this code on a new device to restore your progress. Keep it secret!', th: 'ใส่รหัสนี้ในเครื่องใหม่เพื่อกู้ความคืบหน้า ห้ามบอกใครนะ!' },
newCode: { en: 'New code', th: 'สร้างรหัสใหม่' },
copy: { en: 'Copy', th: 'คัดลอก' },
copied: { en: 'Copied!', th: 'คัดลอกแล้ว!' },
restore: { en: 'Restore progress', th: 'กู้ความคืบหน้า' },
restoreHint: { en: 'Enter the transfer code from your other device', th: 'ใส่รหัสย้ายเครื่องจากเครื่องเดิม' },
restoreBad: { en: 'That code doesn’t work', th: 'รหัสนี้ใช้ไม่ได้' },
restoreOk: { en: 'Welcome back!', th: 'ยินดีต้อนรับกลับมา!' },
restoreAsk: { en: 'This device has progress too. What should we do?', th: 'เครื่องนี้ก็มีความคืบหน้าอยู่ จะทำอย่างไรดี?' },
restoreCombine: { en: 'Combine both', th: 'รวมทั้งสองเครื่อง' },
restoreCloudOnly: { en: 'Use restored only', th: 'ใช้ของที่กู้มาอย่างเดียว' },
tooMany: { en: 'Too many tries. Try again later.', th: 'ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่' },
```

---

## 9. Config, local dev and deploy

### `wrangler.toml`

```toml
name = "hanzi-rush"
pages_build_output_dir = "dist"
compatibility_date = "2026-09-01"

[[d1_databases]]
binding = "DB"
database_name = "hanzi-rush"
database_id = "<paste from `wrangler d1 create hanzi-rush`>"
migrations_dir = "migrations"

[vars]
ALLOWED_ORIGINS = "capacitor://localhost,https://localhost,http://localhost,http://localhost:5173,http://127.0.0.1:5173"

# Preview deployments get their own DB so branch testing never touches prod data
[[env.preview.d1_databases]]
binding = "DB"
database_name = "hanzi-rush-preview"
database_id = "<paste from `wrangler d1 create hanzi-rush-preview`>"
migrations_dir = "migrations"

[env.preview.vars]
ALLOWED_ORIGINS = "capacitor://localhost,https://localhost,http://localhost,http://localhost:5173,http://127.0.0.1:5173"
```

Secret: `IP_SALT`. Set it with `npx wrangler pages secret put IP_SALT` (prod) and in `.dev.vars` locally (`IP_SALT=dev`; `.dev.vars` must be added to `.gitignore`).

### `package.json` scripts (devDeps: `wrangler`, `@cloudflare/workers-types`, `vitest`)

```json
"dev:api": "wrangler pages dev dist --port 8788",
"db:local": "wrangler d1 migrations apply hanzi-rush --local",
"db:remote": "wrangler d1 migrations apply hanzi-rush --remote",
"typecheck:api": "tsc -p functions/tsconfig.json",
"test": "vitest run",
"deploy": "npm run build && wrangler pages deploy"
```

`build` stays `tsc --noEmit && vite build`. The root `tsconfig.json` include becomes `["src", "shared"]`.

### Local dev

```bash
npm i -D wrangler @cloudflare/workers-types vitest
npm run db:local                 # creates .wrangler/state D1 and applies migrations (no account needed)
npm run build                    # pages dev serves dist/ + functions/
npm run dev:api                  # API on http://127.0.0.1:8788
npm run dev                      # Vite on :5173; vite.config proxies /api → 8788 (same-origin, like prod)
# exercise the cross-origin/CORS path, as Capacitor will:
VITE_API_BASE=http://localhost:8788 npm run dev
npx wrangler d1 execute hanzi-rush --local --command "SELECT * FROM scores LIMIT 20"
```

`vite.config.ts` addition: `server: { proxy: { '/api': 'http://127.0.0.1:8788' } }`.

### First deploy (run by the owner; these commands touch the Cloudflare account)

```bash
npx wrangler d1 create hanzi-rush            # paste database_id into wrangler.toml
npx wrangler d1 create hanzi-rush-preview    # paste into [env.preview]
npm run db:remote
npx wrangler d1 migrations apply hanzi-rush-preview --remote
npx wrangler pages secret put IP_SALT
npm run deploy
```

If the project deploys through dashboard Git integration instead, bindings in `wrangler.toml` are used once the Pages project is "wrangler.toml-managed". Otherwise, add the D1 binding `DB` in Settings → Functions.

---

## 10. Work packages

Both packages code against `shared/api.ts` from day one and can run fully in parallel. B can develop against a stub: it treats every network error as "offline", which is a supported state anyway.

### WP-A: backend (`functions/`, `server/`, `migrations/`, `wrangler.toml`)
1. `migrations/0001_init.sql` (§3, verbatim); `wrangler.toml` (§9); `functions/tsconfig.json`; `.dev.vars` in `.gitignore`.
2. `server/http.ts`, `cors.ts`, `crypto.ts` (WebCrypto `crypto.getRandomValues`, `crypto.subtle.digest('SHA-256')`), `auth.ts`, `ratelimit.ts`.
3. Endpoints in §4 order: health → players → me (GET/DELETE) → recovery-code → recover → save → runs/start → runs → boards → `[[path]]` 404.
4. Validation: `validateSaveDoc`, `validateSubmit` (types and ranges), then `checkRun` from shared.
5. `boards.ts` (upsert, top, rank, total) and `prune.ts`.
6. Done when `npm run typecheck:api` passes and a curl script against `wrangler pages dev` passes:
   - create → PUT save rev 0 → PUT with a stale rev gets 409 → start run → submit → board shows the run
   - an implausible score gets 422
   - CORS preflight from `capacitor://localhost` returns 204 with the echoed origin
   - an unknown `/api/x` returns a JSON 404

### WP-B: client (`src/`, `vite.config.ts`, root `tsconfig.json`, `package.json` scripts)
1. `src/core/storage.ts` shim (§7.0); `vite-env.d.ts`; tsconfig include `shared`; vite proxy.
2. `store.ts` additions (§7.3); `registry.ts` re-exports `Mode` from shared.
3. `merge.ts` + `merge.test.ts` (§5.3 table and properties).
4. `api.ts`, then `cloud.ts` (§5.4, §7.2, §7.4).
5. Hooks: `main.ts` (two lines), `QuizGame.ts`, `results.ts`, `home.ts`.
6. UI: `leaderboard.ts`, the `levels.ts` trophy, the profile cloud card, `ui/transfer.ts`, i18n keys, CSS, `ICON.trophy`/`ICON.cloud`.
7. Done when:
   - `npm run build` and `npm test` pass
   - the game still works with no backend (all cloud UI degrades to offline/hidden)
   - with `dev:api`, two browser profiles can transfer via code, and a run on each shows on the board with rank
   - DEV `checkRun` stays silent across a full rush and practice run of each game

### Contract-change protocol
Any change to `shared/api.ts` gets a one-line note in the PR description. If `SCORING` changes because game balance changed, bump `SCORING_VERSION` and add it to `SUPPORTED_SCORING`. Keep the old version during the app-store rollout window: native clients update slowly. For the old version, the server must keep the old `SCORING` table, so at that point move `SCORING` into a `Record<version, …>`.

---

## 11. Known limitations (accepted for v1)
- Clients are trusted to play honestly. A scripted client can submit plausible scores within the caps. Mitigations if needed: shadow-ban (`status=1`) and filtering boards to `verified=1`.
- Both devices spending the same coins offline gives free spending (coins clamp at 0). Two daily claims on two offline devices on the same day both pay.
- Two browser tabs share the store and race, as they already do today. The CAS + merge keeps the server consistent, but one tab's in-memory state may be stale.
- Ranking queries scan the index up to the player's rank. If a board passes about 50k players, cache `total`/`rank` or precompute.
- No account merge on recover; the previous guest is orphaned.

### UX notes (cloud UI)

- **Name prompt.** The first time a run returns a rank and `profile.name` is empty, the results screen shows a one-time "Pick a name for the leaderboard" modal (`sanitizeName`, `LIMITS.nameMaxChars`). The "asked" flag is device-local (`storage`, key `hanzi-rush:name-asked:v1`): Save or Later both end the automatic prompt; the profile field stays available. Save writes `progress.profile.name`, `store.save()`, and flushes the cloud save (the server takes the name from the save PUT), then drops the cached boards. While the prompt is open, results keyboard shortcuts (Enter = retry) are ignored.
- **Trophy buttons** (levels, results) are hidden only for `off`. For `disabled`/`signedOut` they stay: the board is fetched anonymously.
- **Leaderboard rows.** The name truncates with an ellipsis; the "You" tag is always visible.
