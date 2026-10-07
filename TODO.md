# TODO

Design background: [`docs/cosmetics-shop.md`](docs/cosmetics-shop.md).

## Jade coin (玉币): future uses and sources

Jade is the server-held premium currency (see §11 of the design doc). The first use is cosmetic boxes. Ideas noted for later, none designed or scheduled:

### More things Jade could buy (in-game cosmetics)

- Progress bar skins: the XP bar on the profile card and home chip, the lives/timer bar in games.
- Result-screen effects and the "NEW BEST!" celebration style.
- Tap and answer effects: particle sprites for correct answers, combo and FEVER visuals.
- Cabinet skins for the word-gacha vault (lacquer colours, door lattice).
- Mascot (Deng Deng) costumes and idle animations.
- Profile `background` and `banner` slots (already reserved in the profile card layers).
- Name effects beyond the launch set (animated ink, shimmer).
- Direct-buy rotating shop (daily deals) and an Exchange where duplicates are spent to craft a chosen item.

### Sources of Jade

- [ ] Real-money packs: store receipt verification endpoint, `iap` ledger rows (iOS, Android). Web needs a separate payment path.
- [ ] Rewarded ads: server-side verification, a daily cap, `ad` ledger rows.
- [ ] One-time Jade reward for unlocking a title, tier-scaled 0/5/10/20/40 (design doc §11.4). Needs server-side verification of the requirement. Decide how retroactive unlocks are handled.
- [ ] Limited events and season rewards, granted through `player_grants`.

### Before real money ships

- [ ] Refund / support path and a way to look up a player's ledger.
- [ ] Spend confirmation on large purchases.
- [ ] Decide the Jade-to-price ratio and regional pricing.
- [ ] Review store rules for randomised paid items (loot box disclosure of odds, age rules). Show the drop rates in the box screen.

## Titles (ฉายา)

- [ ] `wardrobe` and `fullset` titles once the cosmetic inventory exists.
- [ ] Rush-score titles; calibrate thresholds from real board scores first.
- [ ] Server-granted titles: Founder, Daily Champion, Weekly Top 10, All-time Top 100, seasonal events (ตรุษจีน, สงกรานต์).
- [ ] Review the Thai and Chinese copy of the 33 new titles with a native reader.
