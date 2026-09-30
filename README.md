# 汉字 Hanzi Rush

A juicy, cartoon-style platform of mini games for learning Chinese (HSK 1–6), in Thai 🇹🇭 and English 🇬🇧.
Static site: no backend. Runs at 60fps on mobile.

## Games
| Game | Status |
| --- | --- |
| **Meaning Rush** (ทายความหมาย): see the hanzi and pick its meaning | ✅ playable |
| Pinyin Pop · Tone Hero · Stroke Master · Listen & Catch | 🔒 placeholders (coming soon) |

**Meaning Rush modes**
- **Rush**: 3 lives, a timer on every question, endless. Speed bonus × combo multiplier.
- **Practice**: 20 questions with no timer.

**Juice loop:** combo builds heat stages at 5, 10, 20 and 30. Each stage adds music layers, spins the sunburst faster, shifts the colours hotter and brings bigger particle bursts and praise banners. The FEVER gauge fills as you answer, and at full it triggers **FEVER TIME**: ×2 points, a gold world and falling coins (古钱) and yuanbao (元宝).
A wrong answer flips the card in WebGL to show the answer, pinyin and an example sentence (中文 + pinyin + TH/EN). Missed words come back 4 questions later and are listed on the results screen with text-to-speech.

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
    quiz/               Meaning Rush (QuizGame.ts, cardFace.ts)
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
