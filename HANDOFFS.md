# Handoff: cosmetics shop, Jade coin, titles

Read this first, then [`docs/cosmetics-shop.md`](docs/cosmetics-shop.md) (the full design; this file is the checklist) and [`TODO.md`](TODO.md) (future ideas).

## Where things stand

| Phase | What | Status |
| --- | --- | --- |
| A | Titles (ฉายา): 49 titles, declarative data, grouped list, summary toast | **Done, in the PR** (not visually checked in a browser) |
| Design | Jade economy, three box tiers, player card modal, avatar set | **Done**, in `docs/cosmetics-shop.md` §11 and §12 |
| Assets | 30 WebP avatars (SVG sources, manifest, style guide, build script) | **Done, in the PR** (5 are weak, see below) |
| B | Foundations: catalog, `players.look`, identity renderer | Not started |
| B2 | Jade wallet on the server | Not started |
| C | Wardrobe, Shop, box pulls | Not started |
| C2 | Player card modal | Not started |
| D | Depth: effects, set boxes, Exchange, deals | Not started |
| E | Prestige: grants, background and banner slots | Not started |

Branch `worktree-titles`, commit `1f61a78` (plus the commit that adds this file). No code beyond titles exists yet; every phase below is still to build.

## Before merging this PR

- [ ] **Look at the new Profile titles list in a browser.** It typechecks and builds, but the section headers, the "Next up" strip and the layout on a phone width were never viewed. Run `npm run dev`, open Profile, and check the list with a fresh save and with a save that has progress (set `localStorage['hanzi-rush:v1']`).
- [ ] **Retroactive unlock burst.** With an existing save that qualifies for many new titles, confirm one "N new titles" toast appears (not a stack of toasts), and that the titles are marked seen afterwards.
- [ ] **Thai and Chinese copy** of the 33 new titles (`shared/titles.ts`), reviewed by a native reader.
- [ ] Decide whether to redraw the 5 weak avatars now or later: crane (woodpecker-like), horse (cow-like), lion dancer (spiky ball), baize (mane like wings, 16 KB), qilin (close to a dragon). Edit `assets/avatars/<id>.svg`, then `node scripts/build-avatars.mjs <id>`.
- [ ] Look at the avatars at real size (34 px row, 112 px card) once the renderer exists. They were only checked on a contact sheet.

## Decisions already made (do not reopen without a reason)

- Titles are earned, never random. Cosmetics are bought with **Jade coin**; coins and Jade never convert.
- **Jade, pulls and inventory are server-authoritative** (real money and ads are coming). The shop is online-only. Equipping works from a cached inventory.
- One box machine that drops any slot, three tiers: **Standard 100 / Select 250 / Supreme 600 Jade**, ×10 costs 9. Rates and pity in `docs/cosmetics-shop.md` §11.6b. Pity costs 3,000 Jade in every box.
- Starter grant **100 Jade** (one Standard box). Daily Jade **10, 10, 15, 15, 20, 20, 50** (140 a week), claimed with the same tap as the coin reward, paid by the server.
- Duplicate refunds by **item rarity**, not box price: 5 / 10 / 25 / 50 / 100 Jade.
- Title Jade rewards (one-time): tier 0 to 4 pay 0 / 5 / 10 / 20 / 40, needs server-side verification first.
- Tapping a board row opens a **player card modal**; "Show my card" toggle, default on.
- 30 avatars in the Deng Deng mascot style, split 10 / 8 / 6 / 4 / 2 by rarity (`assets/avatars/manifest.json`).

## Phase B: Foundations (no visible change; safe to ship alone)

Goal: the plumbing for looks, with defaults only, so nothing changes for players.

- [ ] `shared/cosmetics.ts`: `Slot`, `Look`, item catalog (id, slot, rarity, set, source, zh/en/th), box definitions (`id, price, rates, pity, minRarity`). Avatar items come from `assets/avatars/manifest.json`. Frames, name effects and badges still need to be designed and listed (target launch counts in `docs/cosmetics-shop.md` §8: about 14 frames, 12 name colours/effects, 20 badges).
- [ ] `sanitizeLook()` next to `sanitizeName` in `shared/api.ts` (known slots only, ids must exist in the catalog for that slot, max 3 distinct badges, about 200 bytes). Make `sanitizeTitle` check the title catalog, not only the id pattern.
- [ ] Migration `0004_look.sql`: `players.look TEXT NOT NULL DEFAULT '{}'`, plus `pub` (8-char public id, unique, backfilled), `card TEXT`, `card_public INTEGER DEFAULT 1` if folding C2 columns in now.
- [ ] `PATCH /me/profile { name?, title?, look? }` (new route under `functions/api/v1/me/`), with a rate limit; keep the existing `profile` piggyback on `POST /runs` (`functions/api/v1/runs/index.ts:126`).
- [ ] Add optional `look` to `BoardEntry` and `EffortEntry` in `shared/api.ts`; select `p.look` in `server/boards.ts` (`top`, `myEntry`) and `server/effort.ts`.
- [ ] Save doc: `progress.profile.look`; per-slot last-writer-wins in `src/core/merge.ts` (add the key to the known-key lists or it falls back to a worse rule); validate in `server/validate.ts`; defaults in `src/core/store.ts`.
- [ ] `src/cosmetics/render.ts`: `renderIdentity(look, size, opts)` replacing the hand-drawn seal in four places: `src/screens/leaderboard.ts` (`rowFor`), `src/screens/effort.ts`, the home profile chip (`src/screens/home.ts`), the profile avatar (`src/games/gacha/profile.ts`). Default avatar stays the title glyph seal. Unknown ids render the default.
- [ ] Push the look to the server when it changes (`src/core/cloud.ts`).
- [ ] Size budgets in `docs/cosmetics-shop.md` §6.3: frames must read at 34 px, only the first badge shows on a row, animate name effects only for the top 10 and "me".

Acceptance: boards and the profile look identical to today; `npx tsc --noEmit` and `npx tsc -p functions/tsconfig.json` pass; the migration applies locally (`npm run db:local`).

## Phase B2: Jade wallet (server)

- [ ] Migration `0005_jade.sql`: `players.jade`, `jade_ledger(id, player_id, delta, reason, ref, created_at, balance_after)` with UNIQUE `(player_id, reason, ref)`, `inventory`, `banner_pity`, `jade_daily` (§11.2 of the design doc).
- [ ] Endpoints: `GET /wallet`, `POST /jade/starter` (once per account), `POST /jade/daily` (Bangkok-day streak, slot rewards in §11.4). All idempotent through `ref`.
- [ ] Client wallet cache; Jade balance in the home chip; claim Jade in the existing Daily modal (`src/ui/daily.ts`) with the same tap; offline claims retry later for the same day.
- [ ] Add every new table to the explicit delete list in `functions/api/v1/me.ts`, and say so on the delete-account confirmation (Jade is lost).
- [ ] Tests: replay of the same `ref` does not double-grant; negative balance impossible (`UPDATE ... WHERE jade >= cost` inside a D1 batch).

## Phase C: First release

- [ ] **Wardrobe** screen from a "Customize" button on Profile; tabs Frame / Avatar / Name / Badges / Title with a live preview card; the title list moves here. Locked items show as silhouettes with rarity.
- [ ] **Shop** screen from Home and the Vault: the three boxes, the odds and pity shown on screen, pull ×1 and ×10.
- [ ] `POST /shop/pull { box, qty, ref }`: server roll, spend, inventory, pity and refunds in one D1 batch; replaying a `ref` returns the original result.
- [ ] Generalize `src/games/gacha/opening.ts` (445 lines, tied to word cards and `LevelMeta`) behind a `Reveal` interface; add a cosmetic box machine (the Deng Deng lantern is the natural theme).
- [ ] Server verifies equipped items against the inventory (closes the forged-equip gap).
- [ ] Launch content: the 30 avatars plus frames, name effects and badges; at least about 60 items in total so duplicates are not immediate.
- [ ] Add the `wardrobe` (own 25 cosmetics) and `fullset` titles (the evaluator needs an inventory requirement kind).

## Phase C2: Player card modal

- [ ] Public id `players.pub` on board and effort entries as `pid` (never expose `players.id`).
- [ ] Rebuild `players.card` (level, words, games, accuracy, best combo, best streak, titles unlocked) on every accepted `PUT /save` (`functions/api/v1/save.ts`).
- [ ] `GET /players/:pid/card` (auth optional; 404 for hidden players).
- [ ] The modal: opens instantly from the row data, fills the stats when the request returns, 60 s cache, "Show my card" toggle on Profile.

## Phase D: Depth

- [ ] Animated name effects; themed set boxes and set bonuses; the Exchange (spend duplicates to craft a chosen item) if players ask; rotating direct-buy deals.

## Phase E: Prestige and expansion

- [ ] `player_grants` for server-given items (rank and season badges, Founder), `background` and `banner` slots on the card, limited-time boxes, server-granted titles.
- [ ] Real-money packs and rewarded ads (receipt verification, `iap` and `ad` ledger rows). See `TODO.md` "Before real money ships" (odds disclosure, refunds, regional pricing, store rules).

## Things that will bite (from the code, see `docs/cosmetics-shop.md` §10)

- `server/validate.ts`: any failure rejects the whole save push. `progress.pity` must stay a single int, so box pity uses its own table.
- `src/core/merge.ts`: unknown keys fall back to last-writer-wins, which loses data for additive fields unless registered.
- `src/games/gacha/opening.ts` is coupled to word cards.
- Profile reaches the server only with a run today; the look needs its own push.
- Old native app builds will meet new item ids: they must render the default, never crash. Deploy the server before any native build that uses new ids.

## Working notes for the next session

- Typecheck: `npx tsc --noEmit` and `npx tsc -p functions/tsconfig.json`. Build check: `./node_modules/.bin/vite build --outDir <tmp>`.
- Avatars: `node scripts/build-avatars.mjs [ids] [--sheet]` (needs Google Chrome and `cwebp`, `brew install webp`). Style rules in `assets/avatars/STYLE.md`.
- Title data lives in `shared/titles.ts`; requirement wording and evaluation in `src/core/meta.ts`.
- In this Claude session, git commands were refused by the worktree guard, so commits and pushes were done by the user with `!`. A worktree has no `node_modules`; this one used a symlink to the main checkout's.
- A full simulation of the economy was run in throwaway scripts (not in the repo). The numbers are in `docs/cosmetics-shop.md` §11.7; rerun with real pull data before retuning.
