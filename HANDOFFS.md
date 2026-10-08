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
| C | Box pulls (server), 46 frames / name effects / badges, Shop, chest ceremony, Wardrobe | Server and art **merged and deployed** (PRs #13, #14, migration `0006`); UI in PR `feat/c-shop-ui` |
| C2 | Player card modal: `pid` on boards, card snapshot on save, `GET /players/:pid/card`, modal, "Show my card" | PR `feat/c2-player-card` (no migration) |
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
- [ ] Phase C on a real phone (iOS Safari and Android WebView): the chest ceremony, the Shop at 360 px, the Wardrobe, name effects with `background-clip: text` on Thai, the frames at 34 px on the board.
- [ ] A first real pull in production: starter Jade buys one Standard box, the result shows on the leaderboard from another device.
- [ ] Native-speaker copy for the launch cosmetics. Thai: แหวนหยก (frame_jadering, maybe วงหยก), หมึกจีน, น้ำเงินคราม, อานุภาพมังกร, จี้หยก, บัณฑิต, เทพเจ้า, ประกายหงส์, plus the Shop and Wardrobe strings in `src/core/i18n.ts`. Chinese: 灯穗, 木叶, 明珠.
- [ ] Old native builds against the new server: unknown frame / name-effect / badge ids must render the default.

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
| Box pulls: `pull`, `rollPull` (pure), concurrency design in the file header | `server/shop.ts`; route `functions/api/v1/shop/pull.ts`; tables `shop_pulls`, `inventory`, `banner_pity`, `players.pull_seq` / `pull_at` (`0005`, `0006`) |
| Ownership check of a look (`ownedLook`), used by `PATCH /me/profile` and `PUT /save` | `server/inventory.ts` |
| Client: Jade, inventory and pity cache, `wallet.pull()`, `newPullRef()` | `src/core/wallet.ts` |
| Client: equip / unequip from the cached inventory | `src/cosmetics/equip.ts` |
| Launch art: one item block per slot (`FRAMES`, `NAME_FX`, `BADGES`), CSS per slot, dev previews | `shared/cosmetics.ts`, `src/cosmetics/{frames,namefx,badges}.css`, `dev/preview-*.html` (`npx vite`) |
| Generic opening ceremony: `Reveal`, `RevealBatch`, `Machine`, `Price`, async `again` | `src/games/gacha/opening.ts`; word cards `wordReveal.ts` + `cabinet.ts`; cosmetics `cosmeticReveal.ts` + `chest.ts` (treasure chests) + `treasureArt.ts` (display-case faces, chest-lid backs); preview `dev/preview-chests.html` |
| Shop screen and purchase flow (one ref per purchase, kept across retries) | `src/games/gacha/ShopScreen.ts`, `shopBuy.ts` |
| Wardrobe screen (tabs, preview card, titles list) | `src/games/gacha/wardrobe.ts` |
| `players.pub`, `card`, `card_public` (for C2, not yet used) | `migrations/0004_look.sql` |
| Tests (run from the repo root) | `npm run test:wallet`, `npm run test:shop`, `npm run test:ownership` |

## Phase C: First release (done, 2026-10-07)

Players buy boxes with Jade, get cosmetics, equip them, and others see them on the boards. Built in parallel tracks (art ×3, server, UI) on separate worktrees, then one Opus review pass on the art; that split worked well.

- **Content:** 14 frames (5/4/3/1/1), 12 name effects (4/3/3/1/1), 20 badges (8/6/3/2/1), plus the 30 avatars: 76 gacha items. Frames are a ring drawn over the edge of the avatar disc (decided; no board-row relayout). Board rows are **light** and the profile card (`.pf-card`) is **dark**: name effects have stops for both. Badge rarity reads as a progression: COMMON flat, RARE one ring, EPIC gold double ring, LEGENDARY/MYTHIC shine/glow.
- **`POST /shop/pull`:** server roll, per-box hard pity, ×10 EPIC+ guarantee, unowned ×3, duplicate refunds by rarity, one D1 batch; a replayed ref returns the stored result. A forced pity roll keeps the box odds above the floor (Standard pity: LEGENDARY 80% / MYTHIC 20%). An empty rarity pool resolves upward first.
- **Ownership:** `PATCH /me/profile` and `PUT /save` keep only owned items in `players.look`; the save itself is never rejected. (`POST /runs` never wrote the look.)
- **Shop** from Home and the Vault (chip with a dot until the first box), chest ceremony, **Wardrobe** from Profile → Customize, titles list moved there, title `wardrobe` (requirement kind `cosmetics`).
- `fullset` moved to phase D (it needs sets).

## Phase C2: Player card modal

- [x] Expose `players.pub` on board and effort entries as `pid` (never expose `players.id`).
- [x] Rebuild `players.card` (level, words, games, accuracy, best combo, best streak, titles unlocked) on every accepted `PUT /save` (`functions/api/v1/save.ts`).
- [x] `GET /players/:pid/card` (auth optional; 404 for hidden players).
- [x] The modal: opens instantly from the row, fills the stats when they arrive, 60 s cache; "Show my card" toggle on Profile sets `card_public` via `PATCH /me/profile`.

Notes: titles unlocked = known title ids in `profile.seen` (title evaluation is client-only). `players.card` is NULL until a player's first save after deploy ("No stats yet"). The card endpoint is `no-store`; the client caches 60 s per pid. `app.back()` now dispatches Escape through the DOM so an open modal closes first. `cardPublic` shares the `PATCH /me/profile` rate limit and retries once on 429. Code: `server/card.ts`, `functions/api/v1/players/[pid]/card.ts`, `src/ui/playerCard.ts`, `shared/level.ts`; test `npm run test:card`.

To verify by hand: the modal at 360 px, Android back closes the card, a hidden card shows the private line, the toggle right after equipping in the Wardrobe.

## Phase D: Depth

- [ ] Title `fullset` (complete a cosmetic set): needs `set` on items and a requirement kind.
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
- Anything that writes `inventory` outside `server/shop.ts` (grants, Exchange) **must bump `players.pull_seq` in the same batch**, or a concurrent pull can label a duplicate as new.
- Per-badge CSS must be scoped `.id-badges .id-badge[data-b=…]` (identity.css loads after badges.css). Never rename or remove a released item id: players own it.
- The `wardrobe` title is evaluated live from the cached inventory, so on a new device it shows locked until the first wallet refresh.

## Working notes

- Typecheck: `npx tsc --noEmit` and `npm run typecheck:api`. Build: `npm run build`.
- Avatars: `node scripts/build-avatars.mjs [ids] [--sheet]` (needs Google Chrome and `cwebp`, `brew install webp`).
- Worktrees: create them yourself with `git worktree add`, then start `claude` inside. In a session that entered a worktree with the built-in worktree tool, git commands were refused by its guard. A new worktree has no `node_modules`: symlink the main checkout's or run `npm install`.
- Parallel sessions worked well for B and B2. Give each session a clear "do not touch" list, fixed migration numbers, and a merge order.
- The economy simulation numbers are in `docs/cosmetics-shop.md` §11.7; rerun with real pull data before retuning.
