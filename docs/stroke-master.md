# Stroke Master (笔): design and implementation plan

A new game mode. HSK words fall from the top of the screen. The player writes them in a pane at the bottom, **stroke by stroke and in the correct stroke order**. A finished word explodes and shows its pinyin and meaning.

- Playable prototype (artifact, private): https://claude.ai/artifact/HFcUoy7HTFws4i3A4URE6m
- Prototype source: [`dev/stroke-prototype/`](../dev/stroke-prototype/). Open `stroke-master.html` in a browser to play it. It is a reference only and is not part of the build.
- The checklist for the implementing session is [`HANDOFF-stroke-master.md`](../HANDOFF-stroke-master.md).

The prototype writes **single characters** (35 HSK 1 characters). The real mode writes **words** (see Decisions). Everything else in the prototype (scene, effects, matcher, targeting, hint) carries over.

## 1. Decisions (settled 2026-10-25)

| # | Decision | Why |
|---|---|---|
| D1 | **Word mode.** The falling unit is an HSK word (1–4 characters), written character by character. | 4,295 of 4,991 words (86%) have more than one character, and our meanings (`p`, `th`, `en`) are per word. Single characters would need about 2,600 new Thai glosses. |
| D2 | **Launch with HSK 1–3.** HSK 4–6 come later, behind a slower pace (phase 5). | HSK 5–6 characters average roughly 10–12 strokes, and words reach 30+ strokes. Rush pacing breaks down there. |
| D3 | **Outline on by default**, with a toggle in the pane. The setting is remembered. | Without it, high-stroke characters become a memory test. With it on, the mode teaches stroke order rather than recall. |
| D4 | **Own matcher**, ported from the prototype (`dev/stroke-prototype/matcher.js`). Do not use Hanzi Writer's `quiz()`. | `quiz()` grades one character in its own SVG target. We grade one stroke against every falling word at once, on our own canvas. The matcher reuses Hanzi Writer's rules: average distance, start and end gates, direction, Fréchet shape, and "a later stroke fits better". |
| D5 | **Stroke data:** `hanzi-writer-data@2.0.1` (from Make Me a Hanzi), pinned as a **devDependency** and baked by a build script into one JSON file per level. No CDN fetch at runtime. | Reproducible offline builds. The existing service worker caches same-origin `/data/*` on first fetch. |
| D6 | **Ranked at launch (HSK 1–3, rush and zen).** The client sends one `[strokes, combo, perfect]` tuple per destroyed word; the server recomputes the score exactly with `strokeWordPoints` and checks a per-stroke and per-word time floor. No stroke data on the server, no migration, no `SCORING_VERSION` bump, no continues. | The score is a pure function of the tuples, so it is verifiable without the glyph data. A later formula change needs a version bump and a version-aware `checkRun`. |
| D7 | **Keep the prototype's look:** a dark ink-night scene (moon, ink-wash ranges, fog, embers), gold for success, vermilion for danger, a 米字格 pane. | The user approved the draft. It is the one dark game in a cartoon app, which is fine because the scene is self-contained. HUD buttons use the app's existing widgets. |
| D8 | **Credit the data.** The Arphic Public License text ships next to the data, with a credit line in the app. | License condition of `hanzi-writer-data` / Make Me a Hanzi graphics. |

## 2. Gameplay

### Loop
- Words spawn above the sky area and fall toward the ground line, which is the top of the pane.
- The player writes in the pane. Each stroke is graded on `pointerup`.
- A correct stroke advances the targeted word. When the last stroke of the last character lands, the word is destroyed.
- A word reaching the ground costs a heart in Rush. Three hearts per run. "Continue" (buy a heart) can reuse `cloud.runTicket` later. It is not needed for launch.

### Targeting (from the prototype, `submit()` in `game.js`)
- **Unlocked.** The stroke is graded against the *next expected stroke* of every live word (its current character and stroke index). Among the words that accept it, pick the lowest score, where `score = avg - 45 * depth` and `depth` is how far down the sky the word is (0..1). That word becomes the target.
- **Locked.** Once the target has at least one correct stroke, or the player tapped it, strokes are graded **only** against the target. This is what enforces order. Without the lock, a wrong-order stroke would silently match some other word.
- **Tap a word** in the sky to lock it (`tapLocked`). Progress is kept per word, so switching away and back is fine.
- A target that lands or is destroyed unlocks.

### Feedback
| Event | Pane | Sky | Sound |
|---|---|---|---|
| Correct stroke | Raw ink fades and the canonical stroke shape fades in gold-white | Gold bolt from the pane to that stroke. The stroke lights gold with a bloom. Small spark burst. | Pentatonic pluck that rises with the stroke index |
| Wrong stroke | Raw ink turns red, jitters, drips, fades. The pane shakes. The chip says **Wrong stroke order**, **Wrong direction** or **Try that stroke again**. | Target ring flashes red and the glyph jitters | Low blip |
| 2 misses on the same stroke | Hint: the expected stroke pulses jade, and a dot travels along its median from the start point | | |
| Character done (word not done) | Pane flashes the character, then clears for the next character | That character turns fully gold | Chime |
| Word done | Clear flash | Hitstop 90 ms, flash, two shock rings, the strokes fly apart (`shatter`), 60 sparks. Then a label rises: `+score PERFECT`, the pinyin, then `th · en`. | Bell chord rooted on the combo, sub thump, noise swell |
| Word lands | | Red splash, screen shake, red vignette. A label shows the word, pinyin and meaning in red, so it is still learned. | Thud |

The `grade()` result already carries `why: 'order' | 'backwards' | 'miss'` for the chip copy.

### Modes
- **Rush:** endless, 3 hearts, speeds up with words cleared.
- **Zen** (the app's practice mode, `ctx.mode === 'zen'`): 20 words, slow fall, landing costs nothing (the word counts as missed), no combo pressure.

### Pacing (start values, tune on device)
Give each word a time budget based on its stroke count, not a fixed fall time:

```
strokes   = total strokes in the word
fallTime  = clamp(6 + 1.5 * strokes - 0.25 * cleared, 5 + 0.9 * strokes, 60)   // seconds to cross the sky
spawnGap  = max(2.4, 6.4 - 0.17 * cleared)
maxOnScreen = min(4, 2 + floor(cleared / 5))
word pool: start with words of ≤ 6 total strokes, raise the cap by 2 every 3 words cleared
```

The prototype's character-level numbers are `fallTime = max(10, 25 - 0.45 * cleared)`, `spawnGap = max(2.4, 6.4 - 0.17 * cleared)`, `maxOnScreen = min(5, 2 + floor(cleared/4))` and leniency `1.15`.

### Scoring (ranked, verifiable)
- Only word awards add to the score. Per-stroke points are cosmetic (pitch, floaters).
- Word combo `c`: +1 when a word is destroyed (the tuple holds the value after the increment); reset to 0 on a landing and on a wrong stroke against a locked target. A stroke that matches nothing with nothing locked has no effect.
- `perfect` = no wrong strokes were graded against that word.
- Per word: `strokeWordPoints(s, c, p) = round(7·s·(100 + 15·min(c,20))·(p ? 3 : 2) / 200) · 10` (`shared/api.ts`), the exact integer form of `round(70·s·(1 + min(c,20)·0.15)·(perfect ? 1.5 : 1) / 10) · 10`. Golden: s=10, c=1, p=1 → 1210; s=10, c=20, p=1 → 4200.
- `RunStats`: `correct` = words destroyed, `asked` = destroyed + landed, `maxCombo` = max `c`, `strokeWords` = the tuples in destroy order, `missed` = words that landed.
- Rush ends on the landing that takes the last heart; other words landing in the same frame are not counted (`rush_lives` needs exactly 3 landed). Zen never spawns more than 20 words and ends when all 20 are resolved.
- Words with more than `STROKE.maxWordStrokes` (80) strokes are never spawned. The server rejects a run whose duration is below `0.8 · (2100 + max(Σ strokes · 150, asked · 500))` ms (`minDurationMs`; words spawn at least 0.6 s apart, so 500 ms per resolved word is safe).

## 3. Data

### Build script: `scripts/build-strokes.mjs` (new, `npm run data:strokes`)
1. For each level n = 1..6, read `public/data/hsk{n}.json` (the `Word[]` produced by `scripts/build-data.mjs`).
2. Collect the Han characters of every word (`/\p{Script=Han}/u`).
3. Read `node_modules/hanzi-writer-data/<char>.json`. Keep only `strokes` and `medians`. Drop `radStrokes`.
4. Write `public/data/strokes/hsk{n}.json` as `{ "<char>": { "s": string[], "m": number[][][] } }`. Each level file is self-contained, so the game loads one file per level.
5. Log the words with a missing character and the count of excluded words. The game skips words whose characters are not all present.
6. Copy the package's `ARPHICPL.TXT` to `public/data/strokes/ARPHICPL.txt`.

Measured sizes (built 2026-10-25, `npm run data:strokes`; gzip -9). No word is excluded at any level: every Han character in every word has stroke data.

| Level | Chars | Raw | Gzip |
| --- | --- | --- | --- |
| HSK 1 | 178 | 349 KB (348,813 B) | 145 KB (144,639 B) |
| HSK 2 | 200 | 441 KB (441,034 B) | 182 KB (182,091 B) |
| HSK 3 | 393 | 908 KB (908,447 B) | 374 KB (373,664 B) |
| HSK 4 | 722 | 1.68 MB (1,684,625 B) | 691 KB (691,238 B) |
| HSK 5 | 1,226 | 3.01 MB (3,009,112 B) | 1.23 MB (1,230,138 B) |
| HSK 6 | 2,064 | 5.35 MB (5,353,173 B) | 2.18 MB (2,184,288 B) |

Gzip is about 2.4x smaller than raw. Launch levels 1-3 cost about 0.7 MB over the wire in total.

Character counts measured on 2026-10-25: HSK1 178, HSK2 200, HSK3 393, HSK4 722, HSK5 1,226, HSK6 2,064, all unique 2,632.

### Runtime loader: `src/core/strokes.ts` (new)
Mirror `loadLevel` in `src/core/data.ts:31`: a cached `fetch` of `data/strokes/hsk{n}.json`, deleted from the cache on failure. Convert once into ready-to-draw objects:

```ts
interface Glyph { ch: string; n: number; paths: Path2D[]; med: [number, number][][] }   // med already y-flipped: [x, 900 - y]
```

### Coordinates (easy to get wrong)
- The data lives in a 1024 box with **y pointing up**, and the glyph spans y = -124..900.
- **Medians** for the matcher: flip once to y-down with `[x, 900 - y]`.
- **Paths**: draw with `ctx.setTransform(k, 0, 0, -k, left, top + 900 * k)` where `k = size / 1024`. Multiply by `dpr` (see `glyphAt` and `paneGlyph` in the prototype).
- **User points**: convert from pane pixels to the box with `[(x - box.x) / box.B * 1024, (y - box.y) / box.B * 1024]`.
- `shadowBlur` ignores the transform, so scale it by `dpr` yourself.

## 4. Code layout

```
src/games/stroke/
  StrokeGame.ts   Screen: state machine (intro → countdown → play → over), run lifecycle, scoring, spawn/pacing
  matcher.ts      pure grader, ported from dev/stroke-prototype/matcher.js and typed; no DOM
  scene.ts        backdrop painter (sky, moon, ranges, fog, embers), falling-word rendering, FX list
  pane.ts         pointer capture, brush rendering, 米字格, outline, hint, pane FX
  sfx.ts          stroke/done/miss/hurt sounds; prefer adding to engine/audio.ts if it fits its API
src/core/strokes.ts   loader (above)
scripts/build-strokes.mjs
scripts/test-strokes.mjs
public/data/strokes/hsk{1..6}.json + ARPHICPL.txt
```

Keep `StrokeGame.ts` under about 600 lines. `QuizGame.ts` is 958 lines. Do not subclass it, because its phase model (ask, lock, reveal) does not fit a real-time game. Copy what is needed: the results hand-off, `awardRun`, `store.recordWord`, hearts UI and the countdown.

### Wiring
- `src/games/registry.ts:31`: the `stroke` entry already exists, locked. Add `desc: 'strokeDesc'` and `load: () => import('./stroke/StrokeGame')`.
- `src/core/i18n.ts`: `strokeName` exists at `:65` (`Stroke Master` / `เซียนขีดอักษร`). Add `strokeDesc` plus the in-game strings, each with `en` and `th`:
  - `Draw here` / `วาดตรงนี้`
  - `Write any falling word` / `เขียนคำที่กำลังตก`
  - `Wrong stroke order` / `ลำดับขีดผิด`
  - `Wrong direction` / `ทิศทางขีดผิด`
  - `Try that stroke again` / `ลองขีดนี้อีกครั้ง`
  - `No match on screen` / `ไม่ตรงกับคำไหนเลย`
  - `Outline` / `โครงร่าง`
  - Ask a native speaker to check the Thai, as with the other copy.
- **Level gating:** the level picker (`src/screens/levels.ts:98-109`) loads words and the game module. Strokes load inside the game. Show the intro or countdown while `loadStrokes(level)` resolves, and keep Start disabled until it has. For launch, lock levels 4–6 for this game (the D2 gate). Show them as "coming soon" in the same way locked games are shown.
- **Words:** filter `ctx.words` to words whose Han characters all have stroke data, with at most 4 characters.
- **Pinyin setting:** `store.settings.pinyin` (toggled on the level picker). When it is on, draw pinyin above each falling word, small and dim.
- **Outline setting:** add `strokeOutline: boolean` to `Settings` in `src/core/store.ts:12`, default `true`.
- **Progress:** `store.recordWord(word.h, ok)` when a word is destroyed (ok) or lands (not ok).
- **End of run:** build `RunStats` with `game: 'stroke'` and call `app.go(() => resultsScreen(stats))`. include `strokeWords` and `runId` (from `cloud.startRun(boardKey('stroke', level, mode))` in `start()`); `src/screens/results.ts:55` submits because `stroke` is in `RANKED_GAMES`.
- **Theme:** `Screen.theme` must be a `ThemeName` (`src/engine/background.ts:8-15`). Use `vault`, the existing dark theme, or add an `ink` theme. The game paints its own full-screen scene canvas over it anyway.
- **Shared engine:** use `engine/shake.ts` for shake and the app's `muteButton` and `langToggle` widgets in the HUD. The prototype's particle and FX code stays local to the game, because it draws into the game's own canvas and depends on the glyph geometry. Only reuse `engine/particles` if it can draw into that canvas.

### Rendering a word
- A falling word is a row of its characters inside one ink plate. Character size is `clamp(sky.w * 0.17, 54, 86)` for one character, shrinking so a 4-character word fits 80% of the sky width.
- The current character of the targeted word gets the reticle. Characters already finished are fully gold.
- The pane shows only the **current character** of the target. The chip shows the whole word with the current character highlighted, plus stroke dots for that character.
- **Performance (production grade):** the prototype fills every glyph path every frame with `shadowBlur`, which will be slow on low-end Android with four complex words on screen. Cache each word's glyph to an offscreen canvas and redraw it only when its progress changes. Put the glow in the cached bitmap, and run per-frame effects only for the ~0.5 s after a stroke lights. Use `prefers-reduced-motion` to cut particles to about 30% and turn off shake.

### Input
- `touch-action: none` on the pane. Use `setPointerCapture`, read `getCoalescedEvents()`, and ignore a second pointer while one stroke is in progress.
- Ignore strokes shorter than 18 units in the 1024 box (stray taps).
- Pause on `onHidden` (the app calls it on `visibilitychange`), and clamp `dt` to 50 ms.

## 5. Tests: `scripts/test-strokes.mjs` (add to `npm test`)
Bundle `src/games/stroke/matcher.ts` with esbuild, the same way `scripts/test-titles.mjs` does, then:
1. **Coverage:** every HSK 1–3 word with only Han characters has stroke data for all of them (or the exclusion list is exactly what the build logged).
2. **Accepts sloppy correct strokes:** for every stroke of every HSK 1–3 character, the median moved ±60 units, scaled 0.85–1.1 and jittered ±15 units must pass `grade` at leniency 1.15. Target: 100%. Report the characters that fail.
3. **Rejects backwards strokes:** the reversed median fails with `why: 'backwards'`, except where a stroke is nearly symmetric. List any exceptions explicitly.
4. **Rejects wrong order:** drawing median j (j > i) when stroke i is expected fails. Report the rate per level. The prototype got 184/184 on 35 HSK 1 characters. Expect some genuine ambiguity in dense characters, so list those characters instead of asserting 100%.
5. **Picks the right target across words:** for pairs of words that share a first stroke, the targeting rule selects the expected word.

The prototype's quick version of 2–4 is `dev/stroke-prototype/test-matcher.cjs`.

## 6. Phases and acceptance

| Phase | Scope | Done when |
|---|---|---|
| **P1 Data + matcher** | `hanzi-writer-data@2.0.1` devDependency, `build-strokes.mjs`, `public/data/strokes/*`, `src/core/strokes.ts`, `matcher.ts`, `test-strokes.mjs` | `npm run data:strokes` is reproducible, the test passes, and file sizes are recorded in §3 |
| **P2 Playable mode (HSK 1–3, Rush + Zen)** | `StrokeGame`, scene, pane, word rendering, targeting, hint, hearts, results, registry, i18n, settings | Playable from the home screen to the results screen at 360–430 px wide. `npm run build` passes. Coins and XP are awarded and `recordWord` updates progress. |
| **P3 Polish + performance** | Glyph caching, reduced motion, sounds through the app's mute setting, countdown, intro card with a stroke-by-stroke 笔 seal, credit line | 60 fps with 4 words on a mid-range Android phone (or 6× CPU throttle in DevTools), no long tasks over 50 ms during play |
| **P4 Device tuning** | Leniency, pacing and hint threshold tuned on a real iPhone (Safari) and Android (Chrome PWA) | Notes below in §8: false rejects under about 1 in 20 strokes for a careful player, and HSK 3 is finishable for 2+ minutes |
| **P5 HSK 4–6** | Unlock with slower pacing (Zen by default, or a "Calm" rush), cap words at about 25 strokes, and show "outline recommended" | Measured on device, as in P4 |
| **P6 Ranked** (ships with P2) | `'stroke'` in `RANKED_GAMES`, `RANKED_LEVELS`, `STROKE` + `strokeWordPoints`, `strokeWords` payload, stroke branch of `checkRun`, `scripts/test-runs.mjs` (no `SCORING_VERSION` bump) | `npm test` passes, including `test:runs` |

## 7. Risks

- **Ambiguous dense characters** (器, 赢, 量). Parallel strokes sit close together on a pane about 300 px wide. Mitigations: leniency tuning, the hint after 2 misses, and the outline on by default. The test lists the worst characters.
- **Stroke-order disputes** in Make Me a Hanzi data, where it differs from the PRC standard or has errors. Add `data/stroke-overrides.json` (a character mapped to reordered stroke indices), applied by the build script, and a "report this character" link later.
- **Long words at high levels.** This is the D2 gate.
- **Performance** of glow on low-end devices. This is the glyph cache in P3.
- **Licence.** Keep `ARPHICPL.txt` and the credit line. Make Me a Hanzi's `dictionary.txt` (LGPL) is **not** used.

## 8. Tuning log
Add device results here as they come in.
