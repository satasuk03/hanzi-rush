# Avatar style guide

Avatars are cute SVG portraits in the style of the Deng Deng mascot (`src/ui/mascot.ts`). Reference files: `rabbit.svg` (COMMON), `tiger.svg` (EPIC), `dragon.svg` (MYTHIC). **Open all three and match them closely**; consistency across the set matters more than any single avatar.

Each avatar is shown cropped to a **circle** (34 px on a leaderboard row up to 112 px on a profile card), so it must read at tiny sizes: bold shapes, big eyes, no fine detail.

## Canvas

- `viewBox="0 0 256 256" width="256" height="256"`, one file per avatar: `assets/avatars/<id>.svg`.
- A full-bleed square background (`<rect width="256" height="256" fill="url(#bg)"/>`), no transparency.
- **Circle safe zone:** everything that matters (the whole character, the seal) must sit inside a circle of radius ~118 around (128,128). Corners are cropped away.
- The character is centred, head-and-shoulders or head-only, roughly 150-170 px wide. A soft ground shadow ellipse under it: `<ellipse cx="128" cy="228" rx="70" ry="10" fill="#2a1a3a" opacity=".25"/>`.

## Drawing rules

- **Outline:** `stroke="#2a1a3a"`, width 7 for the big shapes (head/body), 5 for medium (muzzle, ears' inner), 3.5-4.5 for small features. `stroke-linejoin="round"`, `stroke-linecap="round"`.
- **Fill:** flat saturated colours, no gradients on the character itself (gradients only on the background and gold).
- **Gloss:** one soft white ellipse on the upper left of the head, `fill="#fff" opacity=".5"`, rotated ~25-28 degrees.
- **Eyes:** dark ellipses `fill="#2a1a3a"` (about rx 11 ry 15) with a white highlight circle (r ~4.8) at the upper right of each. Dragon-style white eyes with a pupil are fine for fierce or noble characters.
- **Cheeks:** pink blush ellipses `fill="#ff9fb0"` (or `#ff7a95`, opacity .85) under the eyes.
- **Mouth:** small, a simple round-capped path stroke (width ~4.5), optionally a little fang or tooth.
- **Gold** (horns, mane, ornaments): `url(#gold)` gradient `#fff3c0` to `#f4c542` to `#b47a1c`, or flat `#ffd35a` / `#fff0b8`, always with the ink outline.
- No text except the seal. No drop shadows or filters (they bloat the WebP).
- Keep shapes simple: a finished file is usually 2-6 KB of SVG.

## Seal (every avatar)

A small red seal with the avatar's hanzi, placed **inside the circle safe zone**, at the lower right of the character. Use exactly this block, changing only the glyph:

```svg
<g transform="rotate(-6 180 204)">
  <rect x="162" y="186" width="36" height="36" rx="6" fill="#c3272d" stroke="#2a1a3a" stroke-width="4"/>
  <text x="180" y="214" text-anchor="middle" font-family="Kaiti SC, STKaiti, PingFang SC, serif" font-size="26" font-weight="700" fill="#f7ecdc">兔</text>
</g>
```

Draw the seal last so it sits on top. Keep the character's face clear of the seal (shift the body up or left if needed).

## Background by rarity

Define `<radialGradient id="bg" cx=".5" cy=".4" r=".85">` with these stops, and add the extras:

| Rarity | Name | Stops (centre to edge) | Extras |
| --- | --- | --- | --- |
| 0 | COMMON | `#f4effa` to `#b4adc0` | none |
| 1 | RARE | `#cfe3ff` to `#1f5fd0` | 1 white 4-point sparkle |
| 2 | EPIC | `#e0bdff` to `#7a2fc4` | 2 white sparkles |
| 3 | LEGENDARY | `#fff0b8` to `#d98a0b` | 3 sparkles in `#fff3c0` and soft light rays (white, opacity .12) |
| 4 | MYTHIC | `#ff8aa3`, `#e02a52` (at .6), `#8f0d2a` | 3 sparkles in `#fff3c0`, light rays (white, opacity .14), gold on the character |

Sparkle = 4-point star path, e.g. `M36 52l4 10 10 4-10 4-4 10-4-10-10-4 10-4z` (scale or move it; keep it out of the character's face and inside the safe circle). Rays: see the `<g fill="#fff" opacity=".14">` block in `dragon.svg`.

## Higher rarity = more ornament

COMMON: a plain, friendly character. RARE: a little extra (a scarf, flower, accessory). EPIC: a clear signature feature (stripes, glowing marking, crown piece). LEGENDARY: gold ornaments and a more imposing silhouette. MYTHIC: gold mane/horns/halo, the most detailed of the set. Never sacrifice readability at 34 px.

## Build and check

```
node scripts/build-avatars.mjs <id> [<id> ...]     # writes public/avatars/<id>.webp and assets/avatars/.build/<id>.png
node scripts/build-avatars.mjs --sheet             # contact sheet of every avatar, circle-cropped: assets/avatars/.build/sheet.png
```

Open `assets/avatars/.build/<id>.png` to look at your result. Each WebP must stay under 20 KB (the script flags it). The ids, glyphs and rarities are in `manifest.json`.
