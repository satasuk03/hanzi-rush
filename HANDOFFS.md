# Handoff: cosmetics shop, Jade coin, titles

Read this first, then [`docs/cosmetics-shop.md`](docs/cosmetics-shop.md) (the full design; this file is the checklist) and [`TODO.md`](TODO.md) (future ideas).

## Where things stand (2026-10-07)

| Phase | What | Status |
| --- | --- | --- |
| A | Titles (ฉายา): 49 titles, declarative data, grouped list, summary toast | **Merged and deployed** (PR #8) |
| Assets | 30 WebP avatars (SVG sources, manifest, style guide, build script) | **Merged** (5 weak, see below) |
| B | Foundations: `shared/cosmetics.ts`, `players.look`, `PATCH /me/profile`, identity renderer | **Merged and deployed** (`2e51900`) |
| B2 | Jade wallet: ledger, starter grant, daily claim, client cache, Jade in the home chip | **Merged and deployed** (`c1dd915`) |
| — | Home screen rework, Jade shown in the Daily login cells | **Merged and deployed** (`ed4dbef`) |
| C | Wardrobe, Shop, box pulls, frames / name effects / badges content | **Next** |
| C2 | Player card modal | Not started (its DB columns already exist in `0004_look.sql`) |
| D | Depth: animated effects, set boxes, Exchange, deals | Not started |
| E | Prestige: grants, background and banner slots, real money | Not started |

Every merge to `main` deploys through `.github/workflows/deploy.yml`: typecheck, build, **apply D1 migrations to production**, then deploy Pages. So merging a migration changes the production database immediately. Keep migrations additive and backward compatible.

## Still to verify on the live build

Nobody has checked these by hand yet:

- [ ] Profile: the grouped titles list and the "Next up" strip, at phone width, with a fresh save and with a save that has progress.
- [ ] An old save that qualifies for many new titles shows **one** "N new titles" toast.
- [ ] With no look equipped, the leaderboard, effort board, home chip and profile look as they did before phase B.
- [ ] Daily login claims coins and Jade with one tap, the Jade balance updates in the home chip, and the coin part still works offline.
- [ ] A new account receives the 100 Jade starter grant exactly once.
- [ ] Thai and Chinese copy of the 33 new titles (`shared/titles.ts`), read by a native speaker.
- [ ] The 5 weak avatars (crane, horse, lion dancer, baize, qilin): redraw or accept. Edit `assets/avatars/<id>.svg`, then `node scripts/build-avatars.mjs <id>`.

## Decisions already made (do not reopen without a reason)

- Titles are earned, never random. Cosmetics are bought with **Jade coin**; coins and Jade never convert.
- **Jade, pulls and inventory are server-authoritative** (real money and ads are coming). The shop is online-only. Equipping works from a cached inventory.
- One box machine that drops any slot, three tiers: **Standard 100 / Select 250 / Supreme 600 Jade**, ×10 costs 9. Already encoded in `shared/cosmetics.ts` (`BOXES`, `boxPrice`, `PITY_RARITY`). Pity costs 3,000 Jade in every box.
- Starter grant **100 Jade**. Daily Jade **10, 10, 15, 15, 20, 20, 50**, Asia/Bangkok day. Both live.
- Duplicate refunds by **item rarity**, not box price: 5 / 10 / 25 / 50 / 100 Jade (`DUPLICATE_REFUND`).
- Title Jade rewards (one-time): tier 0 to 4 pay 0 / 5 / 10 / 20 / 40. Not built; needs server-side verification of the requirement.
- Tapping a board row opens a **player card modal**; "Show my card" toggle, default on.
- 30 avatars in the Deng Deng mascot style, split 10 / 8 / 6 / 4 / 2 by rarity.

## What exists in code (build on these, do not re-create them)

| Need | Where |
| --- | --- |
| Slots, `Look`, item catalog (`ITEMS`, `itemById`, `itemInSlot`), boxes, refunds, `sanitizeLook` | `shared/cosmetics.ts` |
| Title data | `shared/titles.ts`; wording and evaluation in `src/core/meta.ts` |
| Identity rendering: `renderIdentity`, `paintIdentity`, `applyNameFx`, `renderBadges`, `avatarSrc` | `src/cosmetics/render.ts`, `src/cosmetics/identity.css` |
| Saving a look: `PATCH /me/profile`; look on board and effort entries | `functions/api/v1/me/profile.ts`, `server/boards.ts`, `server/effort.ts` |
| Jade ledger: `applyJade`, `spendJade`, `claimStarter`, `claimDaily`, `walletState` | `server/wallet.ts`; routes `functions/api/v1/wallet.ts`, `functions/api/v1/jade/*` |
| Wallet types (`WalletResponse`, `JadeDaily*`) | `shared/api.ts`, section "Jade" |
| Client wallet cache | `src/core/wallet.ts` |
| Tables `inventory`, `banner_pity` (created, not yet used) | `migrations/0005_jade.sql` |
| `players.pub`, `card`, `card_public` (for C2, not yet used) | `migrations/0004_look.sql` |
| Wallet tests | `node scripts/test-wallet.mjs` (run from the repo root) |

## Phase C: First release (next)

Goal: players can buy boxes with Jade, get cosmetics, equip them, and others see them on the boards.

1. **Content first (can run in parallel with the code).** Only the 30 avatars exist; the catalog has placeholders for the other slots. Launch needs about **14 frames, 12 name colours/effects, 20 badges**, weighted toward COMMON/RARE.
   - Frames: SVG/CSS layers that read at 34 px (bold shapes, no fine detail), drawn outside the avatar circle so they never hide the face.
   - Name effects: CSS only (solid colour, gradient, shimmer, glow); readable on the dark board; animated only for the top 10 rows and "me"; respect `prefers-reduced-motion`.
   - Badges: a glyph on a seal shape, matching `.pc-seal`; must read at 16 px.
   - Add them to `ITEMS` in `shared/cosmetics.ts` with rarity and names (zh/en/th). Follow `assets/avatars/STYLE.md` for the look. The avatar work was done by 3 parallel subagents plus one fix pass; that worked well.
2. **`POST /shop/pull { box, qty, ref }`**: roll on the server with `BOXES` rates and per-box pity (`banner_pity`), unowned items weighted ×3, ×10 guarantees EPIC+, spend with `spendJade`, write `inventory`, refund duplicates by rarity, all in **one D1 batch**; replaying a `ref` returns the original result. Extend `scripts/test-wallet.mjs` (or add a test) for pity, the ×10 guarantee, refunds and replay.
3. **Inventory in the wallet response** (or `GET /inventory`), cached client-side in `src/core/wallet.ts`.
4. **Server checks equipped items against `inventory`** in `PATCH /me/profile` and on run submission, so nobody can wear what they do not own.
5. **Shop screen** (from Home and the Vault): the three boxes, prices, the drop rates and pity shown on screen (needed later for store rules), ×1 and ×10, "connect to buy" when offline.
6. **Opening ceremony**: `src/games/gacha/opening.ts` is tied to word cards and `LevelMeta`. Put it behind a `Reveal` interface and add a cosmetic box machine (the Deng Deng lantern fits).
7. **Wardrobe screen** from a "Customize" button on Profile: tabs Frame / Avatar / Name / Badges / Title, live preview card at the top (reuse `renderIdentity`), locked items as silhouettes with rarity. Move the titles list here from Profile.
8. Titles `wardrobe` (own 25 cosmetics) and `fullset`: needs an inventory requirement kind in `shared/titles.ts` and the evaluator in `src/core/meta.ts`.

Acceptance: `npx tsc --noEmit`, `npm run typecheck:api`, `npm run build` and the wallet tests pass; a fresh account can pull with its starter Jade, equip the result, and see it on the leaderboard from another account.

### Phase C work plan (decided 2026-10-07)

Step 0 (shared base) is on `main`: the pull contract (`ShopPullRequest`, `ShopDrop`, `ShopPullResponse`, error `insufficient_jade` = 402, `LIMITS.pullMinIntervalSec`) in `shared/api.ts`; `FRAMES`, `NAME_FX`, `BADGES` blocks and `gachaPool()` in `shared/cosmetics.ts`; per-slot art CSS in `src/cosmetics/frames.css`, `namefx.css`, `badges.css`.

Decisions: frames stay a **ring drawn over the edge of the avatar disc** (`.id-fr::after`), no board-row relayout. The `fullset` title moves to phase D (it needs sets); `wardrobe` ships in C.

| Track | Branch | Owns | Must not touch |
| --- | --- | --- | --- |
| Art: frames | `feat/c-frames` | `FRAMES` in `shared/cosmetics.ts`, `src/cosmetics/frames.css` | every other file |
| Art: name effects | `feat/c-namefx` | `NAME_FX`, `src/cosmetics/namefx.css` | every other file |
| Art: badges | `feat/c-badges` | `BADGES`, `src/cosmetics/badges.css` | every other file |
| Server | `feat/c-shop-server` | `server/shop.ts`, `functions/api/v1/shop/*`, **migration `0006`** (stored pull results), ownership checks in `functions/api/v1/me/profile.ts` and `functions/api/v1/save.ts`, inventory in `src/core/wallet.ts`, tests | `shared/cosmetics.ts` item blocks, `src/screens`, `src/games` |
| UI | `feat/c-shop-ui` | `Reveal` refactor of `src/games/gacha/opening.ts`, Shop and Wardrobe screens, titles list moved off Profile, `wardrobe` title (new inventory requirement kind) | `server/`, `functions/`, `migrations/`, the item blocks |

Merge order: server (carries the migration), then the three art branches, then UI. Each art branch replaces its own `_ph_` placeholders and their CSS.

Pull design points the server track must settle: replay needs the stored result (0006); `spendJade` writes one ledger row, so the pull needs its own batch (spend, refund rows, inventory, pity, result); two concurrent pulls with different refs must not both consume the same pity count.

## Phase C2: Player card modal

- [ ] Expose `players.pub` on board and effort entries as `pid` (never expose `players.id`).
- [ ] Rebuild `players.card` (level, words, games, accuracy, best combo, best streak, titles unlocked) on every accepted `PUT /save` (`functions/api/v1/save.ts`).
- [ ] `GET /players/:pid/card` (auth optional; 404 for hidden players).
- [ ] The modal: opens instantly from the row, fills the stats when they arrive, 60 s cache; "Show my card" toggle on Profile sets `card_public` via `PATCH /me/profile`.

## Phase D: Depth

- [ ] Animated name effects beyond the launch set, themed set boxes and set bonuses, the Exchange (spend duplicates to craft a chosen item) if players ask, rotating direct-buy deals.
- [ ] Title Jade rewards (0 / 5 / 10 / 20 / 40 by tier) once the server can verify title requirements; decide how retroactive unlocks are paid.

## Phase E: Prestige and expansion

- [ ] `player_grants` for server-given items (rank and season badges, Founder), `background` and `banner` slots on the card, limited-time boxes, server-granted titles.
- [ ] Real-money packs and rewarded ads (`iap` and `ad` ledger rows). See `TODO.md` "Before real money ships".

## Things that will bite

- Merging to `main` migrates production (see above).
- `server/validate.ts`: any failure rejects the whole save push. `progress.pity` must stay a single int; box pity has its own table.
- `src/core/merge.ts`: unknown keys fall back to last-writer-wins; register new save keys.
- Old native app builds will meet new item ids: render the default, never crash. Ship a native build that uses new ids only after the server has them.
- `opening.ts` is coupled to word cards.

## Working notes

- Typecheck: `npx tsc --noEmit` and `npm run typecheck:api`. Build: `npm run build`.
- Avatars: `node scripts/build-avatars.mjs [ids] [--sheet]` (needs Google Chrome and `cwebp`, `brew install webp`).
- Worktrees: create them yourself with `git worktree add`, then start `claude` inside. In a session that entered a worktree with the built-in worktree tool, git commands were refused by its guard. A new worktree has no `node_modules`: symlink the main checkout's or run `npm install`.
- Parallel sessions worked well for B and B2. Give each session a clear "do not touch" list, fixed migration numbers, and a merge order.
- The economy simulation numbers are in `docs/cosmetics-shop.md` §11.7; rerun with real pull data before retuning.
