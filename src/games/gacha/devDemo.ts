/**
 * Dev builds only (`import.meta.env.DEV`): a fake box pull so the Shop ceremony can be played without the API server.
 * Rolls by the box's rates, with the ×10 EPIC+ guarantee; nothing is charged and nothing is saved.
 */
import type { ShopPullResponse } from '../../../shared/api';
import { BOX_MULTI, SET_RATE_UP, boxPrice, featuredSet, gachaPool, type BoxDef, type RarityIdx } from '../../../shared/cosmetics';

const roll = (box: BoxDef): RarityIdx => {
  let x = Math.random() * 100;
  for (let r = 0; r < box.rates.length; r++) if ((x -= box.rates[r]) < 0) return r as RarityIdx;
  return box.minRarity as RarityIdx;
};

export function demoPull(box: BoxDef, qty: number): ShopPullResponse {
  const drops = Array.from({ length: qty }, (_, i) => {
    let r = roll(box);
    if (qty >= BOX_MULTI && i === qty - 1) r = Math.max(r, 2) as RarityIdx;
    let pool = gachaPool(r);
    if (box.featured) {
      const feat = pool.filter((x) => featuredSet(Date.now()).set.items.includes(x.id));
      if (feat.length && Math.random() < SET_RATE_UP) pool = feat;
    }
    const it = pool[Math.floor(Math.random() * pool.length)];
    const isNew = Math.random() < 0.7;
    return { itemId: it.id, rarity: r, isNew, copies: isNew ? 1 : 2, refund: isNew ? 0 : [5, 10, 25, 50, 100][r] };
  });
  return { box: box.id, qty, drops, cost: boxPrice(box, qty), refund: 0, jade: 0, pity: {}, replay: false, bonuses: box.featured && Math.random() < 0.25 ? [featuredSet(Date.now()).set.bonus] : [] };
}
