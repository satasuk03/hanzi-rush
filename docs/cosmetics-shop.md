# Cosmetics shop, profile customization, and more ฉายา

Status: ฉายา (§7, phase A) is implemented. Everything else is design for review.
Builds on: [`docs/backend.md`](backend.md) (guest accounts, cloud save, boards), `src/core/meta.ts` (titles), `src/games/gacha/*` (word gacha).

---

## Revision 2: decisions made after the first review

The first draft assumed coins pay for cosmetics and that a client-trusting save was good enough. The decisions below change that. Where a section further down conflicts, **this block and §11 win**.

| Decision | Effect on the design |
| --- | --- |
| Cosmetic boxes cost a **new premium currency, Jade coin (玉币)**, not coins | New wallet; the old "300 coins per pull" is dropped. See §11 |
| Jade will later be sold for real money or earned by watching ads | **Jade, the box pulls and the inventory must be server-authoritative from day one.** A client-held balance in the save file can be edited to infinite Jade. This overrides the "trust the client" model in §4.5 for anything that touches Jade |
| Daily login pays Jade; new players get a starter grant worth exactly one box; duplicates refund a little Jade | §11.3 to §11.5 |
| Avatars are 30 WebP images | §6.2: replaces the "seal glyph" idea. Needs an asset pipeline and a size budget (§11.8) |
| Jade will later buy other in-game cosmetics (progress bar skins etc.) | Not designed now; recorded in `TODO.md` |
| ฉายา first | Done in this branch; see §7 |

Consequences of "server-authoritative" for the rest of the doc:

- `progress.inventory` and `progress.bannerPity` (§3) **move out of the save file** into D1 tables. The client keeps a read-only cache so the Wardrobe opens instantly and offline. The save file no longer holds anything that is worth stealing.
- The equipped `look` can then be **verified against the inventory** on the server, so a forged request cannot wear an item the player does not own. That closes the "forged equip" gap that §4.5 accepted.
- **The shop is online-only.** Offline, the shop shows "connect to buy". Equipping still works from the cached inventory.
- Guests are already real accounts (`players` row + token), so no sign-in is needed to hold Jade. Deleting the account deletes the wallet; the recovery code is the only way to carry Jade to a new device, which the Transfer-code screen should say.

---

## 0. Short answer

Yes, we need all three of these. Nothing like them exists today.

| Need | Why | Where it lives |
| --- | --- | --- |
| **Catalog** | One list of every cosmetic (id, slot, rarity, names, how it is obtained). Client and server both read it. | `shared/cosmetics.ts` (pure data) |
| **Inventory** | What the player owns. Cosmetics have copies, like word cards. | `progress.inventory` in the save doc |
| **Loadout** (the "look") | What the player currently wears, per slot. | `progress.profile.look` in the save, **and** `players.look` on the server |
| **Shop + banners** | Where coins become pulls. | New screen, new `shop` module |
| **Wardrobe** | Equip screen with a live preview card. | New screen, opened from Profile |
| **One identity renderer** | Draws avatar + frame + name + badges identically on the home chip, profile card, leaderboard and effort rows. | `src/cosmetics/render.ts` |

The part that is easy to miss: **other players' cosmetics must reach the leaderboard through the server.** Today the server stores only `players.name` and `players.title`, and only updates them when a run is submitted. Cosmetics need a `players.look` column, a way to push it right away, and a `look` field on board entries.

---

## 1. Principles

1. **Earned vs bought.** Titles (ฉายา) are *earned* by playing: skill and effort, never random. Cosmetics are *bought* with coins: luck and spending. Prestige from each side stays distinct. Titles are not in the gacha.
2. **Display only.** No cosmetic ever changes scoring, rewards or rank. That is what lets us stay client-authoritative (§4.5).
3. **Local-first.** The shop works offline. Equipping works offline. The server only mirrors the look for other people to see.
4. **Data-driven.** Adding an item, a title, a banner or a slot is a data row plus art. No new plumbing. (This is why §3.2 and §7.1 restructure the existing titles.)
5. **Slots are open-ended.** `background` and `banner` come later; the data model and the profile card layout reserve space for them now.
6. **Unknown ids degrade, never break.** An old app build that meets a new item id draws the default for that slot.

---

## 2. Domain model

### 2.1 Slots

| Slot | What it is | Count worn | Shown where |
| --- | --- | --- | --- |
| `frame` | Border around the avatar circle | 1 | home chip, profile card, every board row |
| `avatar` | Profile image inside the circle | 1 | same as frame |
| `nameFx` | Name colour or effect (solid, gradient, shimmer, glow) | 1 | profile card, every board row |
| `badge` | Small decorative emblem | up to 3 | profile card shows all 3; board rows show only the first (space) |
| `title` | Existing ฉายา, **earned**, not a gacha item | 1 | unchanged, plus a tier-coloured ribbon |
| `background` | *(future)* card background | 1 | profile card |
| `banner` | *(future)* top strip of the card, tint on a board row | 1 | profile card, own row |

Default for every slot is "nothing equipped". The default avatar is today's behaviour: the title's first glyph in a tier-coloured seal. So shipping the system changes nothing visible until the player equips something.

### 2.2 Item (catalog entry)

```
id        'frame_jade_dragon'        ^[a-z0-9_-]{1,24}$ (same pattern as titles)
slot      frame | avatar | nameFx | badge | (background | banner later)
rarity    0..4                       reuses RARITIES (COMMON..MYTHIC), colours and seal glyphs
set       'jade_dragon' | null       themed collection (§5.4)
source    gacha | grant | event      'grant' = server-verified (rank badges, founder); never in a gacha pool
names     zh / en / th
art       key into the renderer (CSS class or SVG symbol), not stored in the shared file
```

Rarity reuses the existing five tiers on purpose: same colours, same reveal FX, same player intuition.

### 2.3 Where achievements fit

- **Titles** (ฉายา) stay achievement-only and keep their own slot (§7).
- **Badges** from the gacha are decorative stickers.
- **Recognition that must be trustworthy** ("Top 10 this week", "Founder") is a `grant` badge or title. The server grants it and verifies it before showing it to others (§4.5).

---

## 3. Save document changes

All additive and optional, so `SAVE_FORMAT` stays `1`.

```
progress.inventory   Record<itemId, [copies, firstAtEpochSec]>
progress.bannerPity  Record<bannerId, number>          pulls since last LEGENDARY+ on that banner
progress.profile.look  { frame?, avatar?, nameFx?, badges?: string[] }
progress.stats.cosmeticPulls  number                    (additive, for balancing and titles)
```

`profile.look` sits next to `name` and `title` because it is part of the same "profile card" concept.

### 3.1 Merge rules (`src/core/merge.ts`)

| Field | Rule | Reason |
| --- | --- | --- |
| `inventory` | Same as `mergeCards`: union, copies = server + (local − base) | Two devices can both pull; both must count |
| `bannerPity` | Per-banner last-writer-wins | Matches today's `pity` |
| `look` | Last-writer-wins **per slot**; `badges` as one unit | Changing the frame on phone and the name colour on tablet should both survive |
| `stats.cosmeticPulls` | Additive | Like `pulls` |

All four must be added to the "known keys" lists in `merge.ts`. **If they are not, the fallback `scalars()` treats unknown keys as last-writer-wins and a second device's pulls get silently dropped.**

### 3.2 Server validation (`server/validate.ts`)

- `inventory`: ≤ 1,000 keys, each a 2-tuple of ints, key ≤ 64 chars.
- `look`: object ≤ 16 keys, string values ≤ 64 chars, `badges` ≤ 8 entries.
- `bannerPity`: ≤ 64 keys, int values. **Do not reuse `progress.pity`**: `validateSaveDoc` requires it to be a single int.
- Raise the `profile.seen` cap from 64. With ~50 titles planned plus growth it will be hit, and a failed validation rejects the **entire save push**.
- Save size impact is negligible (about 60 items × 40 bytes), against the 512 KB cap.

---

## 4. Server

### 4.1 Storage

Migration `0004_look.sql`:

```
ALTER TABLE players ADD COLUMN look TEXT NOT NULL DEFAULT '{}';
```

A single JSON column rather than one column per slot. Adding `background` and `banner` later then needs no migration.

Later, for server-verified items (phase 3):

```
player_grants(player_id, item_id, source, granted_at, PRIMARY KEY (player_id, item_id))
```

It must also be added to the explicit child-delete list in `functions/api/v1/me.ts` (account deletion).

### 4.2 Sanitizing (`shared/api.ts`, next to `sanitizeName`/`sanitizeTitle`)

`sanitizeLook(raw)`: keep known slots only; each id must match the pattern **and exist in the catalog for that slot**; `badges` deduped and capped at 3; anything invalid is dropped to "default". Total size capped (~200 bytes). Also validate `title` against the catalog instead of only the pattern.

Because Pages ships the site and API together, the catalog and the server are always in step. Rule for releases: **deploy the server before (or with) any native build that uses new ids.**

### 4.3 Getting the look to the server

Today `name`/`title` are only pushed with `POST /runs`, so a change shows up on the board after the next run. For cosmetics that feels broken ("I bought a frame and nobody sees it").

- New `PATCH /me/profile { name?, title?, look? }`, called (debounced) when the player equips something.
- Keep the existing piggyback on run submission as a safety net.
- Rate-limit it like other authed writes (min interval, a few seconds).

### 4.4 Reading it back

- Add optional `look?: Look` to `BoardEntry` and `EffortEntry`. Additive fields are allowed in v1, so no `/v2`.
- `server/boards.ts` and `server/effort.ts` already join `players` in `top()` and `myEntry()`, so it is one extra column in a few queries.
- Payload: about 80 bytes × 100 rows = 8 KB. Fine, and the client already caches boards for 30 s.
- Add `level` to the server-side player row later, if we want others' profile cards to show it (see §9, question 5).

### 4.5 Trust model

Coins, cards and titles are all client-authoritative today. The save blob is client-merged, and `sanitizeTitle` only checks a pattern, so anyone can already claim any title. Cosmetics are display-only, so the same model is acceptable. What we do and don't protect:

| Threat | Impact | Response |
| --- | --- | --- |
| Forge a request to wear an item you never pulled | Cosmetic prestige only, no money, no rank | **Accepted for v1.** Same as titles today |
| Wear a non-existent or wrong-slot id | Broken rendering | Blocked: catalog check in `sanitizeLook` |
| Wear a `grant` item (Top 10 badge, Founder) you were not granted | Fake credibility | Blocked: server only keeps grant-class ids that are in `player_grants` |
| Real-money currency is ever added | Real loss | **Server-authoritative pulls required.** Keep the client API shaped as `shop.pull(banner, n) → result` so only the implementation moves server-side. The data model (inventory id→copies, look slot→id) is identical either way |

---

## 5. Shop and gacha

### 5.1 Screens

```
Home ──► Shop (商店) ──► banner ──► opening ceremony ──► [Equip now] / [Pull again]
  │         └ tabs later: Daily deals · Exchange
  └────► Profile ──► Wardrobe (衣橱) ──► slot tabs + live preview card
```

- **Shop** is its own screen, reachable from Home and from the Vault. Word gacha stays in the Vault as the "learning" place; the shop is the "style" place.
- **Wardrobe** is a new screen opened from a "Customize" button on Profile. Tabs: Frame · Avatar · Name · Badges · Title. A live preview card is pinned at the top. Locked items show as silhouettes with their rarity, so players can see what exists.
- `profile.ts` is already 214 lines (name card, stats, cloud save, title list). The title list moves into the Wardrobe so Profile does not keep growing.

### 5.2 Pull mechanics

Reuse the existing word-gacha design (`src/games/gacha/gacha.ts`) and keep the numbers close to it:

- Roll rarity first (COMMON 55 / RARE 28 / EPIC 12 / LEGENDARY 4 / MYTHIC 1), then pick an item of that rarity, with unowned items weighted ×3.
- ×10 costs 9, with a guaranteed EPIC+ on the last pull.
- Hard pity: LEGENDARY+ within 30 boxes (§11.6), tracked **per banner**, server-side.
- Duplicate: a small Jade refund by rarity (§11.5).
- Rolls happen on the server (§Revision 2), so the "unowned ×3" weighting uses the server's inventory.

### 5.3 Prices

Superseded: boxes are bought with **Jade coin**, not coins. Prices, income and the simulation are in §11.

### 5.4 Banners are data

`{ id, pool filter, price, pity, rateUp?, startsAt?, endsAt? }`.

- **Standard**: every non-limited `gacha` item, every slot.
- **Set banners** (phase 2): one themed collection, such as "Jade Dragon": frame + avatar + name effect + badge (+ background and banner later). Completing a set gives a set badge and feeds a title. This is how new slots slot in without redesign.
- Limited-time banners are the same row with dates.

### 5.5 Opening ceremony

`opening.ts` (445 lines) is coupled to word cards and to `LevelMeta` (cabinet colours, `drawCardFront`). The staging (rattle → seam light climbs → doors burst → tap to flip → summary grid) and the rarity FX (`SPARK`, `flash`, `revealFx`) are exactly what we want. Plan:

- Introduce a small `Reveal` interface: `{ rarity, isNew, copies, refund, renderFace() }`. Word cards and cosmetics both implement it.
- A new "machine" art for cosmetics. The existing mascot, Deng Deng the lantern (`src/ui/mascot.ts`), is a natural fit: a lucky-lantern machine.
- This refactor is the largest single piece of UI work in the project. Budget it explicitly.

---

## 6. Rendering and the profile card

### 6.1 One renderer

`renderIdentity(look, size, opts)` draws avatar + frame + name + badges. It is the only place that knows how a look becomes pixels, and it is used by:

| Place | Size |
| --- | --- |
| Leaderboard row, effort row | S (34 px avatar) |
| Home profile chip | M |
| Profile / Wardrobe card | L (112 px) |
| Results, notifications | S/M |

It also normalizes the look first: unknown ids and wrong-slot ids fall back to the default.

### 6.2 How the art is made

Pick the cheap, scalable route, since art is the real cost of this feature:

- **Frames**: SVG/CSS layers parameterized by palette and ornament (bamboo, clouds, scales, lotus, gold leaf). One geometry for every size.
- **Name colours/effects**: CSS gradients plus `background-clip: text`; animation by CSS only.
- **Badges**: glyph on a seal shape. Matches the app's 印章 look and the existing `.pc-seal`.
- **Avatars**: the hard one. Candidates, in order of cost:
  1. Seal-style hanzi portraits. The 12 zodiac animals (鼠牛虎兔龙蛇马羊猴鸡狗猪) give 12 items that also teach characters.
  2. Costumes on Deng Deng.
  3. Illustrated animals.
  4. *(optional)* Let a player use any word card they own as an avatar (`card:<level>:<hanzi>`). It uses the existing collection and its rarity at zero art cost, and ties the two economies together.

### 6.3 Constraints to design for now

- **Row budget.** A mobile board row is rank · avatar · name+title · score. Frames must read at 34 px (bold shapes, no fine detail); only one badge shows in a row.
- **Performance.** A board has up to 100 rows. Animated name effects run only on the top 10 and the "me" row; everything else is static. Respect `prefers-reduced-motion`.
- **Legibility.** Name colours must stay readable on the dark board. Define a safe palette with a minimum contrast, and never let an effect hide the name.
- **Bundle.** The renderer is imported by the leaderboard, so keep it small and separate from the shop code (the shop and wardrobe stay lazy chunks, as `profile` is today).
- **Card layers.** Build the card as stacked layers in a fixed order: background → banner → frame+avatar → name → title → badges → stats. `background` and `banner` then arrive later as new layers with no relayout.

---

## 7. Titles (ฉายา)

### 7.1 Restructure first

`TITLES` today is code: each title has a `progress: () => number` closure over `store`. That cannot be shared with the server, and every new title means writing a closure.

Make titles declarative:

```
{ id, zh, en, th, tier, req: { kind, n } }
```

with a small evaluator in `meta.ts` that supports these `kind`s: `level`, `owned`, `ownedIn(level)`, `allOwned`, `stat(key)`, `dailyBest`, `mastered`, `inventory`, `setsComplete`, `grant`. The requirement text (en/th) is generated from a template, so a new title is **one data row**. The ids and metadata move to `shared/` so the server can validate them and render board rows.

### 7.2 Proposed new titles (35)

The 16 existing titles stay. Everything below uses data we already track, except the last two rows. Chinese and Thai copy is a draft: please review the tone, since the existing Thai names are playful.

Level (28 k XP is Lv 20; Lv 30 is about 300 runs; Lv 50 about 1,000 runs):

| id | 称号 | en | th | Requirement | Tier |
| --- | --- | --- | --- | --- | --- |
| adept15 | 高手 | Adept | ยอดฝีมือ | Level 15 | 3 |
| sage30 | 贤者 | Sage | ปราชญ์ผู้รอบรู้ | Level 30 | 4 |
| immortal50 | 仙人 | Immortal | เซียนสวรรค์ | Level 50 | 4 |

Collection:

| id | 称号 | en | th | Requirement | Tier |
| --- | --- | --- | --- | --- | --- |
| bookworm | 书虫 | Bookworm | หนอนหนังสือ | 100 words | 1 |
| archivist | 典藏家 | Archivist | ผู้รักษาตำรา | 250 words | 2 |
| erudite | 博学 | Erudite | พหูสูต | 1,000 words | 4 |
| grandarchive | 大藏经 | Grand Archive | ผู้ครอบครองตำราทั้งปวง | All 4,993 words | 4 |
| hsk2 | 初阶圆满 | HSK 2 Complete | พิชิต HSK 2 | Every HSK 2 word | 2 |
| hsk3 | 进阶圆满 | HSK 3 Complete | พิชิต HSK 3 | Every HSK 3 word | 2 |
| hsk4 | 中阶圆满 | HSK 4 Complete | พิชิต HSK 4 | Every HSK 4 word | 3 |
| hsk5 | 高阶圆满 | HSK 5 Complete | พิชิต HSK 5 | Every HSK 5 word | 3 |
| hsk6 | 登峰造极 | Summit | ถึงจุดสูงสุด HSK 6 | Every HSK 6 word | 4 |

Skill and effort:

| id | 称号 | en | th | Requirement | Tier |
| --- | --- | --- | --- | --- | --- |
| combo15 | 闪电 | Lightning | สายฟ้าแลบ | ×15 combo | 1 |
| combo50 | 连击神 | Combo God | เทพคอมโบ | ×50 combo | 3 |
| combo100 | 无尽连击 | Unbroken | ไม่มีวันขาด | ×100 combo | 4 |
| warmup | 热身 | Warming Up | เริ่มอุ่นเครื่อง | 100 correct answers | 0 |
| forged | 千锤百炼 | Well-Forged | ตีเหล็กตอนร้อน | 1,000 correct answers | 2 |
| tenthousand | 万象 | Ten Thousand | หมื่นคำตอบ | 10,000 correct answers | 4 |
| perfect10 | 完美主义 | Perfectionist | สายเพอร์เฟกต์ | 10 perfect practice runs | 2 |
| flawless | 无瑕 | Flawless | ไร้ที่ติ | 50 perfect practice runs | 3 |
| regular | 常客 | Regular | ขาประจำ | 50 games | 0 |
| veteran | 身经百战 | Battle-Hardened | ผ่านร้อยสนามรบ | 500 games | 3 |
| fluent | 熟能生巧 | Practice Makes Perfect | ชำนาญจนเป็นธรรมชาติ | 50 mastered words (seen ≥5, ≥80% right) | 2 |
| fluent2 | 通晓 | Well-Versed | พูดจีนคล่องปรื๋อ | 500 mastered words | 4 |
| neverdie | 屡败屡战 | Never Say Die | ล้มแล้วลุก | 100 wrong answers (a consolation title) | 0 |

Streak and coins:

| id | 称号 | en | th | Requirement | Tier |
| --- | --- | --- | --- | --- | --- |
| streak3 | 三日 | Warming Streak | เริ่มติดลม | 3-day streak | 0 |
| streak14 | 半月 | Fortnight | ครึ่งเดือนไม่ขาด | 14-day streak | 2 |
| streak100 | 百日 | Centurion | ร้อยวันไม่ร้าง | 100-day streak | 4 |
| streak365 | 岁岁 | Full Year | หนึ่งปีเต็ม | 365-day streak | 4 |
| rich | 富翁 | Tycoon | เศรษฐีเหรียญ | Hold 20,000 coins at once | 4 |

Gacha and style (ties the shop into titles):

| id | 称号 | en | th | Requirement | Tier |
| --- | --- | --- | --- | --- | --- |
| lucky | 初试手气 | Lucky Start | ลองเสี่ยงดวง | 50 word pulls | 0 |
| gamblergod | 赌神 | Gacha God | เซียนกาชา | 1,000 word pulls | 4 |
| mythichunter | 神话猎人 | Mythic Hunter | นักล่าตำนาน | 3 MYTHIC word cards | 4 |
| wardrobe | 衣橱 | Wardrobe | ตู้เสื้อผ้าล้น | Own 25 cosmetics | 2 |
| fullset | 套装 | Full Set | ครบเซ็ต | Complete a cosmetic set | 3 |

`wardrobe` and `fullset` wait for the inventory (phase C). **Implemented: 33 new titles, 49 in total** (the level ladder titles `adept`, `sage`, `immortal` are in the Level table above this excerpt). One id differs from the tables: `fluent2` shipped as `versed`. The source of truth is `shared/titles.ts`.

**Needs new tracking or the server (not in the 35):**
- *Rush score* titles, such as "reach N on HSK 6 rush". The data exists in `progress.best`, but the thresholds should be calibrated from real board scores, not guessed.
- *Server-granted* titles (phase 3): Founder (account created before a cutoff), Daily Champion, Weekly Top 10, All-time Top 100, plus seasonal events (ตรุษจีน, สงกรานต์).
- Habits like "played after midnight" would need a new stat.

### 7.3 UX consequences of 49 titles (implemented)

- The flat list does not scale. The Profile list is now grouped by family (Level, Collection, HSK, Skill & Effort, Streak, Fortune) with an unlocked count per family, and a "Next up" strip shows the three closest started titles. Ladders keep their progression order inside a family (not "unlocked first"), because a ladder reads better in order. It moves into the Wardrobe in phase C.
- **Retroactive unlock burst.** On the first launch after the update, many existing players will qualify for several new titles at once, and `newTitles()` would fire one toast each. Implemented: more than 3 unlocks at once collapse into one "N new titles" toast (`announceTitles` in `src/ui/notify.ts`).
- Titles stay out of the gacha.

---

## 8. Phasing

Titles are independent of everything else and need no server changes beyond one cap, so they go first.

| Phase | Scope | Visible result |
| --- | --- | --- |
| **A. Titles** (done) | Declarative `TITLES`, shared metadata, evaluator, 33 new titles, grouped list, single-toast burst, `profile.seen` cap raised | Many more ฉายา |
| **B. Foundations (no visible change)** | `shared/cosmetics.ts` catalog, `sanitizeLook`, migration `0004` (`players.look`) and the server wallet/inventory tables (§11.2), `PATCH /me/profile`, `look` on board/effort entries, `renderIdentity()` replacing the seal in all 4 places | Nothing yet; safe to ship |
| **B2. Jade** | Wallet + ledger, starter grant, daily Jade in the Daily modal, Jade shown in the home chip | Players start collecting Jade before the shop opens |
| **C. First release** | Wardrobe, launch items + 30 WebP avatars, Shop with Standard banner (server pulls), generalized opening ceremony, per-banner pity, Jade refund on duplicates | Buy, equip, appear on boards |
| **D. Depth** | Animated name effects, set banners and set bonuses, **Exchange** (dupe shards → craft a chosen item), daily/rotating direct-buy deals | Chase goals, less frustration |
| **C2. Player card modal** | Public player id, card snapshot on the server, `GET /players/:pid/card`, the modal opened from board and effort rows (§12) | Tap a row, see the player |
| **E. Prestige and expansion** | `player_grants` (rank/season badges, Founder), `background` and `banner` slots, limited-time boxes | Prestige and expansion |

Launch content target (phase C), weighted toward COMMON/RARE: about 14 frames, 16 avatars (12 zodiac), 12 name colours/effects, 20 badges. Too few items per rarity makes duplicates immediate.

---

## 9. Open decisions (they change the design)

Decided:

- Real money later, so server-authoritative (Revision 2).
- Duplicates refund a little Jade; no shards for now.
- One box machine that drops any slot, with three tiers: Standard / Select / Supreme (§11.6b).
- A small one-time Jade reward per title, tier-scaled (§11.4).
- Tapping a board row opens a **player card modal** (§12).
- Avatars: 30 WebP images in the style of the Deng Deng mascot (§11.8). Three samples exist.

- The 30 avatars: list and rarity split in `assets/avatars/manifest.json` (§11.8).
- A "Show my card" toggle, default on (§12.4).

Nothing is open at the design level. Remaining work is implementation.

---

## 10. Things in the current code that will bite

| Where | Problem |
| --- | --- |
| `server/validate.ts` | `profile.seen` ≤ 64; `progress.pity` must be a single int; any failure rejects the whole save push |
| `src/core/merge.ts` | Unknown keys fall back to last-writer-wins, so un-registered `inventory` loses items across devices |
| `src/core/meta.ts` | Title requirements are closures over `store`, so they cannot go to `shared/` |
| `src/games/gacha/opening.ts` | Coupled to word cards and `LevelMeta`; needs the `Reveal` abstraction |
| `src/core/cloud.ts` (~667) | Profile only reaches the server with a run, so a new look would lag until the next game |
| Leaderboard/effort/home chip/profile | Four separate places draw the avatar seal by hand today; they must share one renderer or they drift |
| `functions/api/v1/me.ts` | Account deletion uses an explicit child-table list; `player_grants` must be added |
| Native builds | Old app builds will meet new ids; they must render the default, never crash |

---

## 11. Jade coin (玉币): the premium currency

### 11.1 Role

| | Coins (金币) | Jade (玉币) |
| --- | --- | --- |
| Earned by | Playing games, daily login | Daily login, starter grant, duplicates; later real money and ads |
| Spent on | Word cards (the learning gacha) | Cosmetic boxes; later other cosmetics (see `TODO.md`) |
| Where it lives | The save file, client-merged | **Server (D1)**, because it will be sold |
| Works offline | Yes | Balance is shown from cache; buying needs a connection |

The two never convert into each other. That keeps the learning loop free and keeps Jade scarce enough to be worth buying later.

### 11.2 Server model

```
players.jade          INTEGER NOT NULL DEFAULT 0     cached balance (the ledger is the truth)
jade_ledger(id, player_id, delta, reason, ref, created_at, balance_after)
                      reason: 'starter' | 'daily' | 'pull' | 'dupe_refund' | 'iap' | 'ad' | 'admin'
                      ref:    idempotency key, UNIQUE per (player_id, reason, ref)
inventory(player_id, item_id, copies, first_at, PRIMARY KEY (player_id, item_id))
banner_pity(player_id, banner_id, pulls_since, PRIMARY KEY (player_id, banner_id))
jade_daily(player_id PRIMARY KEY, last_day, streak)   server-side streak, Asia/Bangkok day
```

Endpoints (all authenticated, all idempotent through `ref`):

- `GET /wallet`: balance, streak status, inventory, pity.
- `POST /jade/starter`: one-time grant, unique on `(player_id, 'starter')`.
- `POST /jade/daily`: grants the next streak slot once per Bangkok day.
- `POST /shop/pull { banner, qty, ref }`: spends Jade, rolls on the server, writes inventory and ledger in **one D1 batch**, returns the result. A retry with the same `ref` returns the original result instead of charging twice.

D1 batches are transactional, so a pull either happens fully or not at all. A cached balance can never go negative: the `UPDATE ... WHERE jade >= cost` guard fails the batch.

Later, `POST /jade/iap` (store receipt verification) and `POST /jade/ad` (server-side ad verification) write `iap` and `ad` ledger rows through the same path. Nothing about the model changes when they arrive.

### 11.3 Starter grant

New accounts receive **100 Jade**, exactly one box. It is granted once, server-side, the first time the wallet is read. Players who already have an account get it too (it is keyed to the account, not to being new). The home chip shows the Jade balance and a pulsing dot on the Shop button until the first box is opened.

### 11.4 Daily login Jade

Same 7-day streak shape as the coin reward, paid by the server:

| Day | 1 | 2 | 3 | 4 | 5 | 6 | 7 | Week |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Jade | 10 | 10 | 15 | 15 | 20 | 20 | 50 | **140** |

Day 7 is the big one, so a broken streak hurts, which is the intended pull to come back. The coin reward and the Jade reward are claimed with the same tap in the Daily modal. If the player is offline, the coin part is claimed locally and the Jade part is requested again when the connection returns, still counting for the same day.

#### Title rewards (small, one-time)

Unlocking a title pays Jade once, scaled by tier. It is deliberately small, so it links ฉายา to the shop without becoming the main income.

| Tier | 0 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| Jade | 0 | 5 | 10 | 20 | 40 |
| Titles in this tier (of 48, `novice` excluded) | 6 | 5 | 11 | 11 | 15 |

Unlocking **every** title pays 955 Jade, about 9.5 boxes, over the whole life of the account. For comparison, daily login alone pays about 7,300 Jade in a year, so titles add roughly 13% at the very most, and a new player's first few titles pay only 25 Jade in total. Tier 0 pays nothing because those titles are trivial.

Rules: paid by the server, keyed to `(player, title id)` in the ledger so it can never pay twice. The client reports "I unlocked X" and the server checks the requirement before paying, which needs the server to know the player's stats; until that is built (the ledger and `reason = 'title'`), titles pay nothing. The existing retroactive burst (existing players unlocking many titles at launch) would pay all at once, so grant retroactive titles without the reward, or cap it. Decide when this ships.

### 11.5 Duplicate refund

A duplicate returns a share of the box price by rarity:

| COMMON | RARE | EPIC | LEGENDARY | MYTHIC |
| --- | --- | --- | --- | --- |
| 5% (5 Jade) | 10% (10) | 25% (25) | 50% (50) | 100% (100) |

Small on purpose for the common cases, so duplicates feel like a consolation and not an income source. A duplicate MYTHIC refunding the full price softens the worst luck.

### 11.6 Prices and pity

| | Value | Why |
| --- | --- | --- |
| Box | **100 Jade** | A round number; the starter grant is exactly one box |
| ×10 | **900 Jade** | Pay for 9, as the word gacha does; guarantees an EPIC or better in the batch |
| Rates | COMMON 55 / RARE 28 / EPIC 12 / LEGENDARY 4 / MYTHIC 1 (%) | Same as the word gacha |
| Hard pity | LEGENDARY or better within **30** boxes, per box type | Cuts the unlucky tail (below) |

This table is the **Standard box**. There are three box types, one shared item pool (§11.6b).

### 11.6b Three box tiers (decided: one box machine, several tiers)

Banner shape is **option A**: every box can drop any slot (frame, avatar, name effect, badge). On top of that, higher tiers cost more and never drop the low rarities.

| Box | Price | ×10 | Drops (%) COMMON / RARE / EPIC / LEGENDARY / MYTHIC | Hard pity (LEGENDARY+) |
| --- | --- | --- | --- | --- |
| **Standard** (漆匣 lacquer, กล่องธรรมดา) | 100 | 900 | 55 / 28 / 12 / 4 / 1 | 30 boxes |
| **Select** (银匣 silver, กล่องเงิน) | 250 | 2,250 | 0 / 60 / 27 / 10 / 3 | 12 boxes |
| **Supreme** (金匣 gold, กล่องทอง) | 600 | 5,400 | 0 / 0 / 60 / 30 / 10 | 5 boxes |

Design rules behind the numbers:

- **Guaranteed floor.** Select never gives a COMMON, Supreme never gives COMMON or RARE. That is the "pay more, get a better reward" promise in plain words, and it is what the box art and the shop screen show.
- **Same price for the guarantee.** The pity costs 3,000 Jade in every box (30×100 = 12×250 = 5×600). A player picks a box by how much variance they like, not by which one is secretly cheaper.
- **Cost per hit improves a little with tier**, mainly for the top rarities:

  | Box | Jade per EPIC+ (no pity) | per LEGENDARY+ | per MYTHIC |
  | --- | --- | --- | --- |
  | Standard | 588 | 2,000 | 10,000 |
  | Select | 625 | 1,923 | 8,333 |
  | Supreme | 600 | 1,500 | 6,000 |

  So Supreme is the efficient way to chase a MYTHIC (40% cheaper than Standard) and is not better for EPICs. That keeps Standard worthwhile.
- **Duplicate refunds are by item rarity, not by box price** (the 5 / 10 / 25 / 50 / 100 Jade table above). Otherwise a Supreme duplicate would refund 150 Jade and the box would pay for itself.
- **Only Standard drops COMMON items**, so Standard is the only way to complete a collection. This is intended.
- The starter grant (100) buys exactly one Standard box. Select and Supreme need saving: about 2 and 4 weeks of daily login.
- Pity counters are separate for each box type, stored per box in `banner_pity`.
- Boxes are data rows (`id, price, rates, pity, minRarity`), so a limited-time or themed box later is one more row.

### 11.7 Simulation: what a free player gets

Monte Carlo (3,000 simulated players per row; script kept out of the repo). Assumptions: a 60-item pool (24 COMMON, 18 RARE, 11 EPIC, 5 LEGENDARY, 2 MYTHIC), a player who claims every day and opens a box whenever they can afford one, unowned items weighted ×3, the duplicate refunds above, and 100 Jade at the start.

| Box price | Jade per week | Hard pity | First EPIC (median week) | First LEGENDARY (median / worst 10%) | First MYTHIC (median) | Items owned of 60 at 1 / 3 / 6 / 12 months | Boxes at 12 months |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 100 | 50 | 5 | wk 17 / wk 49 | never within a year | 5 / 13 / 24 / 41 | 53 |
| **100** | **140** | **50** | 4 | wk 13 / wk 35 | wk 45 | 6 / 16 / 32 / 49 | 75 |
| **100** | **140** | **30** | 4 | wk 12 / **wk 24** | wk 40 | 6 / 16 / 32 / 49 | 76 |
| 80 | 140 | 40 | 3 | wk 9 / wk 22 | wk 35 | 8 / 20 / 38 / 53 | 95 |

Reading it:

- **Recommended: 100 Jade per box, 140 Jade per week, pity 30** (the bold row). A daily player opens about 1.4 boxes a week: first EPIC within a month, first LEGENDARY around week 12, most of a 60-item pool within a year. The worst 10% still get a LEGENDARY by week 24 thanks to pity.
- The slow end is deliberate. Jade will be sold later; if free income already filled the collection in two months there would be nothing to buy. If it feels too slow in testing, lowering the price to 80 is the first lever (last row).
- Pool size matters: with fewer than about 60 items, duplicates start immediately. Launch with at least this many items.
- A **specific** MYTHIC is still a long chase (1% per box, shared among the MYTHIC items). That is what the later Exchange (spend duplicates to craft a chosen item) is for, if players ask for it.
- Retuning needs real numbers. Log pulls per player (the ledger already does) before changing any value.

**The same simulation across the three box tiers** (free player, 140 Jade a week, 100 to start, buying only that box whenever affordable, 3,000 players each):

| Always buys | First LEGENDARY (median / worst 10%) | First MYTHIC (median week) | EPIC+ items owned (of 18) at 6 / 12 months | All items owned (of 60) at 6 / 12 months | Boxes opened in a year |
| --- | --- | --- | --- | --- | --- |
| Standard | wk 10 / 21 | 38 | 6 / 11 | 32 / 49 | 76 |
| Select | wk 10 / 21 | 35 | 6 / 10 | 14 / 24 | 29 |
| Supreme | wk 8 / 21 | 30 | 6 / 10 | 6 / 10 | 12 |

Reading it: for the **same Jade**, the tiers give almost the same number of EPIC-or-better items. What changes is the experience. Standard fills the collection (49 of 60 in a year) but most pulls are commons. Supreme opens few boxes (12 a year), every one is at least EPIC, and the first MYTHIC arrives about 8 weeks earlier. That is the right shape: higher tiers are for people who want fewer, bigger reveals, and for future paying players, not a hidden shortcut for free players. If you want higher tiers to feel more tempting, the lever is a slightly better MYTHIC/LEGENDARY rate in Supreme, not a lower price.

### 11.8 Avatar images (30 WebP)

- 30 avatars, 256×256 WebP, target under 20 KB each (about 600 KB total). Shown at 34 px on a board row, 112 px on the profile card, so 256 px covers 2× screens.
- Served from `public/avatars/`, one `<img>` per row with `loading="lazy"`, `decoding="async"` and explicit width/height so a board does not jump. Bundled into the native builds, so avatars work offline.
- Rarity split for 30 images that matches the rates: 10 COMMON, 8 RARE, 6 EPIC, 4 LEGENDARY, 2 MYTHIC. The art can reuse the rarity colours for background tint.
- **Style: match the game.** The look is the Deng Deng mascot (`src/ui/mascot.ts`): a thick dark-ink outline (`#2a1a3a`), flat saturated colours, pink blush cheeks, big eyes with a white highlight, a soft white gloss on the head, and a small red seal with the hanzi of the animal in the corner. The background is a radial gradient tinted by the rarity colour, so the rarity is readable at a glance. MYTHIC adds light rays, sparkles and gold.
- **All 30 are drawn** (`public/avatars/*.webp`, sources in `assets/avatars/*.svg`). Sizes run from 6.1 KB (brush) to 16.0 KB (baize), about 270 KB in total, all under the 20 KB cap. Weakest at small sizes, worth a second look before launch: crane (reads a little like a woodpecker), horse (a bit cow-like), lion dancer (spiky mane reads like a sea urchin), baize (gold mane reads like wings), qilin (close to a horned dragon).
- **How they are made:** each avatar is a hand-authored SVG (so it matches the mascot exactly and a fix is a text edit), rendered to a 512 px PNG with headless Chrome, then converted to a 256 px WebP with `cwebp -q 88`. All 30 stay under 20 KB. No image-generation model was used: the generated-image route (OpenRouter Seedream) needs an API key that was not available, and a model cannot reliably repeat one exact outline-and-seal style across 30 images. If you still want to try it, the 3 SVGs make good style references.
- **The 30** (`assets/avatars/manifest.json`, drawn from `assets/avatars/STYLE.md` by `scripts/build-avatars.mjs`):
  - COMMON (10): rabbit, rat, ox, goat, rooster, dog, pig, dumpling, teacup, bamboo
  - RARE (8): snake, horse, monkey, panda, koi, crane, turtle, lucky cat
  - EPIC (6): tiger, fox, lion dancer, lantern (Deng Deng), lotus, brush spirit
  - LEGENDARY (4): phoenix, qilin, God of Wealth, Jade Rabbit
  - MYTHIC (2): dragon, Baize (the all-knowing beast, a fit for a language game)
  - The 12 zodiac animals are all there (the dragon, tiger and rabbit plus the other nine). Several tie to titles: the brush spirit to 笔仙, the God of Wealth to 财神爷, and the Jade Rabbit to Jade coin.
- Circle crop: avatars are shown in a circle, so the seal sits inside the safe zone, not in the corner (the first three samples had it in the corner and were redrawn).

### 11.9 Anti-abuse (Jade)

- Every spend and grant is a ledger row with an idempotency key. Replaying a request cannot double-charge or double-grant.
- Pull rate limit per player (a few per second); the existing authenticated rate-limit helper is enough.
- A banned account (`players.status`) cannot spend or claim.
- The server decides the pull result, so a modified client cannot influence it.
- Account deletion removes the wallet, ledger and inventory (add all four tables to the explicit delete list in `functions/api/v1/me.ts`). Say so on the delete-account confirmation, since the Jade is gone for good.

---

## 12. Player card modal (tap a board row)

Decided: tapping a row on the leaderboard or the effort board opens a modal showing that player's card. Tapping your own row opens your card with a "Customize" button (the Wardrobe).

### 12.1 What the card shows

The same layered card as the Profile screen (§6.3), read-only:

- Avatar with frame, name with its effect, title ribbon, up to 3 badges. From `players.look` and `players.title`, which the boards already join.
- Level ring and level.
- A few lifetime stats: words collected, games played, accuracy, best combo, best login streak, titles unlocked (n/49).
- The context of the tapped row: the board and period, rank and score ("#3 · HSK 3 Rush · 12,300").

It is a modal, not a screen: the board stays underneath and the back gesture closes it.

### 12.2 What the server needs

Today a board row has only `name`, a non-unique 4-character `tag`, `title` and the score. The account id (`players.id`) must never be exposed, since it is the account's identity. So:

- **Public id.** `players.pub`, a random 8-character base32 id, unique, created with the account (backfilled for existing accounts). Board and effort entries carry it as `pid`.
- **Card snapshot.** `players.card TEXT` (JSON), rebuilt by the server on every accepted `PUT /save` from the validated save: `level` (from `xp`), words collected, games, correct, questions, best combo, best streak, titles unlocked. Computing it on the server from the save keeps the shape consistent and tiny; the numbers are display-only (a forged save can forge them, as it can forge titles today).
- **Endpoint.** `GET /players/:pid/card`, auth optional like the boards. It returns `{ name, tag, title, look, card, hidden }`. Unknown pid returns 404. Players with `status = 1` (hidden from boards) return 404 as well.
- **Rate limit.** The authenticated limiter already in `server/ratelimit.ts` covers it; anonymous reads use the per-IP limit.

### 12.3 Client behaviour

- Open instantly from the row's own data (avatar, name, title, look, rank, score), then fill in the stats when the card request returns (a skeleton for the stats area). A failed request still shows the instant part and a quiet "stats unavailable offline" line.
- Cache cards in memory for 60 seconds, like the 30-second board cache.
- The modal reuses `renderIdentity()` (§6.1) at size L, so a new slot (background, banner) shows up here with no extra work.

### 12.4 Privacy

Names, titles and scores are already public on the boards, so the card adds only the look and a few aggregate stats. Decided: one toggle on the Profile screen, "Show my card", default on. When off, the modal shows only what the row shows (name, title, rank, score) and no stats. The flag is `players.card_public` and is set through `PATCH /me/profile`.

### 12.5 Cost

One extra column and index (`pub`), one extra JSON column, one new read endpoint, and a rebuild step in the save handler. No new write traffic beyond that; the save path already runs once per push.
