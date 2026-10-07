/** Word cards as ceremony reveals (the HSK vault). Behaviour and look are the pre-Reveal ceremony's, unchanged. */
import type { LevelMeta } from '../../core/data';
import { i18n } from '../../core/i18n';
import { audio, speak } from '../../engine/audio';
import { pressable } from '../../engine/juice';
import { ICON } from '../../ui/widgets';
import { drawCardFront, loadCardFonts } from './cardArt';
import { openCardView } from './cardView';
import { priceFor, type Pull, type PullBatch } from './gacha';
import { miniCard } from './mini';
import type { Price, Reveal, RevealBatch } from './opening';

function wordReveal(level: number, p: Pull): Reveal {
  return {
    rarity: p.rarity,
    isNew: p.isNew,
    copies: p.copies,
    refund: p.refund,
    paint: (w) => drawCardFront(document.createElement('canvas'), w, p.word, p.rarity, { level, no: p.no }, i18n.lang),
    shown: () => speak(p.word.h),
    tile() {
      const m = miniCard(p.word, p.rarity, { isNew: p.isNew, copies: p.copies, meaning: true });
      pressable(m, () => {
        audio.pop(1.1);
        openCardView({ word: p.word, level, no: p.no, rarity: p.rarity, copies: p.copies });
      });
      return m;
    },
  };
}

export function wordBatch(L: LevelMeta, b: PullBatch): RevealBatch {
  return {
    reveals: b.pulls.map((p) => wordReveal(L.n, p)),
    best: b.best,
    label: `HSK ${L.n}`,
    ready: loadCardFonts(b.pulls.map((p) => p.word)),
    titles: b.titles,
  };
}

export const wordPrice = (L: LevelMeta, qty: number): Price => ({ icon: ICON.coin, amount: priceFor(L.n, qty) });
