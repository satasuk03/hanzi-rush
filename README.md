# 汉字 Hanzi Rush

A juicy, cartoon-style platform of mini games for learning Chinese (HSK 1–6), in Thai 🇹🇭 and English 🇬🇧.
Static site: no backend. Runs at 60fps on mobile.

## Games
| Game | Status |
| --- | --- |
| **Meaning Rush** (ทายความหมาย): see the hanzi and pick its meaning | ✅ playable |
| **Hanzi Gacha** (กาชาคำศัพท์): spend coins in the Treasure Vault to collect word cards | ✅ playable |
| **Cloze Rush** (เติมคำในประโยค): fill the missing word in an example sentence | ✅ playable |
| Pinyin Pop · Tone Hero · Stroke Master · Listen & Catch | 🔒 placeholders (coming soon) |

**Meaning Rush modes**
- **Rush**: 3 lives, a timer on every question, endless. Speed bonus × combo multiplier.
- **Practice**: 20 questions with no timer.

**Juice loop:** combo builds heat stages at 5, 10, 20 and 30. Each stage adds music layers, spins the sunburst faster, shifts the colours hotter and brings bigger particle bursts and praise banners. The FEVER gauge fills as you answer, and at full it triggers **FEVER TIME**: ×2 points, a gold world and falling coins (古钱) and yuanbao (元宝).
A wrong answer flips the card in WebGL to show the answer, pinyin and an example sentence (中文 + pinyin + TH/EN). Missed words come back 4 questions later and are listed on the results screen with text-to-speech.

**Cloze Rush · 填**: the example sentence is built from ink-brush glyphs with one glowing gap, and the translation is your clue. Tap a hanzi and it flies out of its button in an arc, thuds into the slot and stamps the answer. Right answers send a wave of light through the sentence, write the pinyin in and slam a red seal (对 → 好 → 绝 → 神 as your combo grows). Wrong answers reject the tile, which drops away, and the true word is brushed in in gold. Same Rush/Practice modes, combo, FEVER and heat stages as Meaning Rush (it extends `QuizGame` via hooks) in a jade-green world. Distractors are same-length words that never appear in the sentence. Tap during the victory lap to skip it.

**Hanzi Gacha · 宝库 Treasure Vault**
- Six cabinets, one per HSK level. Open 1–10 cards at a time with coins earned in games (500-coin welcome gift). ×10 costs 9 and guarantees EPIC+. LEGENDARY+ is guaranteed within 50 pulls (hard pity).
- Five rarities: COMMON 55% · RARE 28% · EPIC 12% · LEGENDARY 4% · MYTHIC 1%. Each word has a fixed rarity per level, assigned by a stable hash, and 4-character idioms skew rare. Duplicates refund coins and stack copies.
- Opening ceremony: the doors rattle and the seam light climbs through the rarity colours up to the best card in the batch, then the doors burst open. Each card flips in WebGL with rarity-scaled FX, and a summary grid follows.
- Cards are painted on canvas: rice paper, a dry-brush ensō, Ma Shan Zheng brush hanzi, a carved seal, foil frames, pinyin, TH/EN meaning and an example sentence. Live holo foil and glare follow the pointer.
- **图鉴 Collection**: overall, per-level and per-rarity progress, plus a grid of every word slot. **Profile**: player level from XP earned by playing games (opening cards gives no XP), lifetime stats, and 14 titles (称号) unlocked by level or achievements. You can equip one on your name card.

## Stack
- **Vite + TypeScript**, vanilla DOM: no framework, instant first paint, 47 KB gzipped
- **GSAP** timelines for every UI motion (squash-stretch, overshoot, elastic)
- **Canvas 2D particle system** (hand-rolled): gravity, drag, lifecycle, additive blending, inward-pull, curved-flight and orbit motion
- **WebGL** card flips (perspective-correct, with lighting and sheen). CSS 3D is never used for large elements.
- **Web Audio**: all SFX and the adaptive pentatonic BGM are synthesized, so there are no audio files
- **SpeechSynthesis** zh-CN pronunciation

## Develop
```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # → dist/
npm run data       # rebuild public/data/hsk*.json from data/raw + data/overrides.json
```
Keyboard: `1`–`4` answer, `Enter`/`Space` continue, `Esc` pause.

## Deploy (Cloudflare Pages)
- Dashboard: Framework preset **None** · Build command `npm run build` · Output directory `dist`
- CLI: `npm run build && npx wrangler pages deploy`

`public/_headers` sets long-lived caching for hashed assets and the vocab JSON.

## Project layout
```
src/
  main.ts               boot + the single GSAP ticker loop (bg → screen → particles → WebGL → shake)
  core/                 app router (iris transitions), i18n (TH/EN), store (localStorage), data loader
  engine/               particles, sprites, background, flip3d (WebGL), audio, shake, juice (GSAP helpers)
  ui/                   shared widgets (lang toggle, buttons), mascot 灯灯
  screens/              home, levels, results
  games/
    registry.ts         game catalogue: add new games here
    quiz/               Meaning Rush (QuizGame.ts, cardFace.ts); QuizGame is the shared engine other rush games extend
    cloze/              Cloze Rush (ClozeGame.ts extends QuizGame: sentence card, flight, seal)
    gacha/              Hanzi Gacha: VaultScreen, opening ceremony, cardArt (canvas cards), collection, profile
  core/meta.ts          coins, XP → level curve, titles, run rewards
  core/rarity.ts        rarity table + deterministic per-level assignment
public/data/hsk1-6.json vocabulary (4,991 words), lazy-loaded per level
data/                   raw enrichment chunks, source lists, manual overrides, build script input
```

### Adding a game
1. Create `src/games/<id>/MyGame.ts` exporting `create(ctx: GameContext): Screen`.
2. Add a `load: () => import('./<id>/MyGame')` to its entry in `src/games/registry.ts`.
3. Reuse `engine/*` (particles, flipper, audio, shake, juice) and `ui/widgets` for a consistent feel.

Looping tweens must go through `loop(key, …)` / `stopLoop(key)` from `engine/juice.ts`. Stopping kills the loop and resets its props to rest in the same frame.

## Data
Word lists come from [complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) (HSK 2.0, levels 1–6), which is based on CC-CEDICT (CC BY-SA 4.0).
Thai/English glosses and example sentences were AI-generated and then cleaned by `scripts/build-data.mjs` plus `data/overrides.json`. Please report any mistakes.
Each entry: `{ h, p, en, th, ex: { zh, py, en, th } }`.
