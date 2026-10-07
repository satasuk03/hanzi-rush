/**
 * One box purchase (POST /shop/pull through wallet.pull). The idempotency `ref` is made once per purchase and reused
 * for every retry of it: after a network failure the server may already have charged, and a replay of the same ref
 * returns the stored result instead of charging again. A purchase that still failed on a transient error stays
 * "unresolved": the next tap on the same box and size reuses its ref, so the player gets the result they missed.
 */
import type { ShopPullResponse } from '../../../shared/api';
import { ApiError } from '../../core/api';
import { wait } from '../../core/util';
import { newPullRef, wallet } from '../../core/wallet';

/** poor: not enough Jade · offline: no backend / no connection · net: transient failure (retry is safe) · busy: rate limited · error: refused */
export type BuyFail = 'poor' | 'offline' | 'net' | 'busy' | 'error';

export class BuyError extends Error {
  constructor(
    readonly kind: BuyFail,
    /** the server's balance, when it told us (402 insufficient_jade) */
    readonly jade?: number,
  ) {
    super(kind);
  }
}

const RETRIES = 3;

export async function buy(box: string, qty: number): Promise<ShopPullResponse> {
  if (!wallet.enabled || !navigator.onLine) throw new BuyError('offline');
  let un = wallet.pending;
  if (!un || un.box !== box || un.qty !== qty) wallet.setPending((un = { box, qty, ref: newPullRef() }));
  return send(un.box, un.qty, un.ref);
}

/**
 * Re-sends a purchase left unanswered (e.g. the app was killed mid-buy) with its original ref. Resolves to the
 * result (fresh or a replay) to play, or null when there is nothing pending or it is still unresolved.
 */
export async function resumePending(): Promise<{ box: string; qty: number; res: ShopPullResponse } | null> {
  const p = wallet.pending;
  if (!p || !wallet.enabled || !navigator.onLine) return null;
  try {
    return { box: p.box, qty: p.qty, res: await send(p.box, p.qty, p.ref) };
  } catch {
    return null;
  }
}

async function send(box: string, qty: number, ref: string): Promise<ShopPullResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await wallet.pull(box, qty, ref);
      wallet.setPending(null);
      // a replay carries the balance from the original pull: fetch the current one
      if (r.replay) void wallet.refresh();
      return r;
    } catch (e) {
      // not an API answer (e.g. a broken body): the pull may have been applied, keep the ref
      if (!(e instanceof ApiError)) throw new BuyError('net');
      if (!e.transient) {
        // a definitive refusal: nothing was applied under this ref
        wallet.setPending(null);
        if (e.code === 'insufficient_jade') {
          const j = (e.body as { jade?: unknown } | null)?.jade;
          void wallet.refresh();
          throw new BuyError('poor', typeof j === 'number' ? j : undefined);
        }
        throw new BuyError('error');
      }
      if ((e.status === 0 && !navigator.onLine) || attempt >= RETRIES) throw new BuyError(e.status === 0 ? 'net' : e.status === 429 ? 'busy' : 'net');
      // 429 (two pulls under a second apart) and 5xx / dropped connections: same ref, after a pause
      await wait(e.status === 429 ? Math.max(1, e.retryAfter ?? 1) * 1000 + 150 : 600 * (attempt + 1));
    }
  }
}
