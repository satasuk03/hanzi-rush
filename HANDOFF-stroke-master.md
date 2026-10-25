# Handoff: Stroke Master (笔)

Read this first, then [`docs/stroke-master.md`](docs/stroke-master.md) (the full plan; this file is the checklist). Section numbers (§) refer to that doc. Play the prototype before writing code: open `dev/stroke-prototype/stroke-master.html` in a browser, or the artifact at https://claude.ai/artifact/HFcUoy7HTFws4i3A4URE6m.

## Where things stand (2026-10-25)

| Phase | What | Status |
| --- | --- | --- |
| Research | Feasibility, stroke-data source, matcher design | **Done**: stroke-by-stroke order grading works, own matcher, `hanzi-writer-data` |
| Prototype | Single-character HSK 1 draft: scene, FX, matcher, targeting, hint | **Done** in `dev/stroke-prototype/` (not part of the build) |
| P1 | Data build + loader + typed matcher + tests | **Done** |
| P2 | Playable word mode, HSK 1–3, Rush + Zen | Not started |
| P3 | Polish and performance (glyph cache, reduced motion, sound, credits) | Not started |
| P4 | Tuning on real phones | Not started |
| P5 | HSK 4–6 at a slower pace | Not started |
| P6 | Ranked (ships with P2) | Done: server, shared and client (`RunAccount` in `score.ts`, startRun/runId/durationMs/strokeWords, 80-stroke word cap, levels trophy clamp, registry `maxLevel` derives from `RANKED_LEVELS`). Docs updated (`docs/stroke-master.md` Scoring, `docs/backend.md` 6.2a). Remaining: real-backend check |

No database migration is needed for P1–P5.

## Decisions already made (do not reopen without a reason)

See §1 for the reasons.

- **Word mode**: a falling HSK word is written character by character. Single characters are not a separate mode.
- **HSK 1–3 at launch**. Levels 4–6 are locked for this game until P5.
- **Outline on by default**, with a toggle that is remembered.
- **Own matcher** (port `dev/stroke-prototype/matcher.js`). Do not use Hanzi Writer's `quiz()`.
- **`hanzi-writer-data@2.0.1`** as a pinned devDependency, baked into `public/data/strokes/hsk{n}.json`. No runtime CDN.
- **Ranked at launch** (HSK 1–3, rush and zen): the client sends one `[strokes, combo, perfect]` tuple per destroyed word and the server recomputes the score with `strokeWordPoints` and checks a per-stroke and per-word time floor. See `docs/stroke-master.md` D6 and "Scoring". No migration, no `SCORING_VERSION` bump.
- **Keep the prototype's dark ink-night look**, gold and vermilion FX, and the 米字格 pane.
- **Ship `ARPHICPL.txt`** and a credit line.

## Before you start

- The user reviews and merges PRs. Do not merge them yourself, and do not branch from unmerged work. Branch from `origin/main` (for example `feat/stroke-master`).
- Every merge to `main` deploys (`.github/workflows/deploy.yml`). Keep P1 (data and tests only, mode still locked) and P2 in separate PRs so the data lands safely first.
- Check `git status` first. The untracked `android/`, `ios/` and `promo/` directories are not yours. Leave them alone.

## P1 checklist: data and matcher

- [x] `npm i -D hanzi-writer-data@2.0.1`. Check its license file name inside the package.
- [x] `scripts/build-strokes.mjs` and the `"data:strokes"` npm script, following §3. Log the excluded words.
- [x] Run it, commit `public/data/strokes/hsk{1..6}.json` and `ARPHICPL.txt`, and record the raw and gzip sizes in §3.
- [x] `src/core/strokes.ts`: a cached loader, plus the `Glyph` conversion with medians flipped to y-down (§3 "Coordinates").
- [x] `src/games/stroke/matcher.ts`: a typed port of `dev/stroke-prototype/matcher.js`. Keep the thresholds: avg ≤ 165·lv, start and end ≤ 260·lv, length 0.35×–2.6×, direction ≥ 0.1, Fréchet ≤ 0.65·lv, and later-stroke ratio 0.6.
- [x] `scripts/test-strokes.mjs` (§5), added to `npm test`. Paste the per-level accept and reject numbers into the PR.

## P2 checklist: playable mode

- [x] `src/games/stroke/StrokeGame.ts`, `scene.ts`, `pane.ts` (§4). Port the visuals from `dev/stroke-prototype/game.js`, then change the falling unit from a character to a word (§4 "Rendering a word").
- [x] Targeting rules exactly as in §2. Lock after the first correct stroke or a tap. Grade only against the target while locked.
- [x] Pacing by word stroke count (§2 "Pacing"). Zen is 20 words, slow, and landing costs no heart.
- [x] Registry entry (`src/games/registry.ts:31`), i18n keys (§4 "Wiring"), and `strokeOutline` in settings.
- [x] Levels 4–6 show as locked for this game.
- [x] Run end: `RunStats` → `resultsScreen`. `awardRun` and `store.recordWord` are called. The board is skipped automatically (`results.ts:55`).
- [x] `npm run build` passes. Played headless at 390x844 (home to results flow); 360 px and 430 px not checked by hand yet.

## Verify by hand (P3–P4)

- [ ] iPhone Safari and an installed Android PWA: strokes register, the page doesn't scroll or zoom while drawing, and audio starts after Start.
- [ ] 60 fps with 4 words on screen under 6× CPU throttle.
- [ ] Every chip message appears for its case: wrong order (draw stroke 2 first on 十), wrong direction (draw 一 right to left), and no match.
- [ ] The hint shows after 2 misses and disappears after the correct stroke.
- [ ] A word that lands still shows its pinyin and meaning.
- [ ] Reduced motion: no shake and fewer particles.
- [ ] A native speaker reads the Thai copy.
- [ ] Log the tuning results in §8.

## What exists in code (build on these, do not re-create them)

| Need | Where |
| --- | --- |
| Game registry and locked `stroke` entry | `src/games/registry.ts:31` |
| `Screen` interface, `app.go` | `src/core/app.ts:8-17` |
| Word data and `loadLevel` (pattern for the strokes loader) | `src/core/data.ts:1-40` |
| Level picker that loads words and the game module | `src/screens/levels.ts:98-109` |
| Run-end flow to copy (results, rewards, progress) | `src/games/quiz/QuizGame.ts` (`awardRun`, `recordWord`, `resultsScreen`); `src/screens/results.ts:23-41` (`RunStats`) |
| Ranked flag on results (`stroke` is in `RANKED_GAMES`; `RunStats` carries `runId`, `strokeWords`, filled by StrokeGame) | `src/screens/results.ts:55` |
| Settings (`pinyin` toggle, add `strokeOutline`) | `src/core/store.ts:12` |
| Name string | `src/core/i18n.ts:65` (`strokeName`) |
| Shake, juice, audio, widgets | `src/engine/shake.ts`, `src/engine/juice.ts`, `src/engine/audio.ts`, `src/ui/widgets.ts` |
| Dark background theme | `vault` in `src/engine/background.ts:15` |
| Service worker (network-first for `/data`, so levels played once work offline) | `public/sw.js` |
| Prototype (matcher, scene, FX, pane, intro seal, synth sounds) | `dev/stroke-prototype/game.js`, `matcher.js`, `template.html` |
| Prototype matcher test | `dev/stroke-prototype/test-matcher.cjs` (expects a folder of `hanzi-writer-data` JSON files as its argument) |

## Gotchas

- Stroke data is **y-up** in a 1024 box with the baseline at 900. Flip the medians once (`900 - y`) and draw paths with a negative y scale (§3).
- `shadowBlur` ignores the canvas transform, so multiply it by `dpr`.
- In the prototype, an unlocked first stroke matches the lowest word that accepts it. Once locked, a wrong-order stroke must **not** retarget to another word. That lock is what makes order matter.
- `dev/stroke-prototype/build.py` reads the stroke JSON from a scratch folder that is not in the repo. Use it only to understand how the HTML was assembled.
