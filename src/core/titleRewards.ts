/**
 * Title Jade rewards, client side. The server verifies each title against the stored save and pays once per title
 * (POST /titles/claim); this module notices when something may be owed, asks, and announces what was paid. It imports
 * `meta` and `wallet` (never the other way round: meta imports wallet).
 */
import { TITLE_REWARD } from '../../shared/titles';
import { cloud } from './cloud';
import { TITLES, isUnlocked, type Title } from './meta';
import { t } from './i18n';
import { wallet } from './wallet';
import { notify } from '../ui/notify';

/** Jade by title tier (shared/titles.ts TITLE_REWARD); tier 0 pays nothing */
export const titleReward = (T: Title): number => TITLE_REWARD[T.tier] ?? 0;

/** unlocked titles that pay Jade and are not yet marked paid */
export const pendingTitleRewards = (): Title[] => TITLES.filter((T) => titleReward(T) > 0 && isUnlocked(T) && !wallet.titlesPaid.includes(T.id));

const DEBOUNCE_MS = 2000;
/** a claim that got no answer (429, network) is retried once after the server's 10 s claim interval */
const RETRY_MS = 11_000;
let timer = 0;
let inflight = false;
let started = false;
let retried = false;
/**
 * The pending ids the server last answered for. Asked again only when they change (a new unlock) or a new save has
 * synced: a claim answer emits a wallet change, so without this a title the server does not see as met (a save it
 * holds differently) would be claimed every DEBOUNCE_MS forever.
 */
let asked = '';
const pendingKey = () => pendingTitleRewards().map((T) => T.id).join(',');

async function claim() {
  if (inflight || !wallet.enabled || wallet.titlesOff || !navigator.onLine) return;
  // the server reads the saved copy of the progress: wait until it has our latest
  const key = pendingKey();
  if (cloud.status !== 'synced' || !key || key === asked) return;
  inflight = true;
  try {
    const r = await wallet.claimTitles();
    if (!r) {
      if (!retried && !wallet.titlesOff) {
        retried = true;
        window.setTimeout(schedule, RETRY_MS);
      }
      return;
    }
    retried = false;
    asked = pendingKey();
    const earned = r.paid.reduce((n, p) => n + p.jade, 0) + r.retro;
    if (earned > 0) notify({ kicker: t(r.retro > 0 ? 'titleJadeRetro' : 'titleJadeKicker'), title: `+${earned} ${t('jade')}`, seal: '玉', tier: 2 });
  } finally {
    inflight = false;
  }
}

const schedule = () => {
  if (timer || !wallet.enabled) return;
  timer = window.setTimeout(() => {
    timer = 0;
    void claim();
  }, DEBOUNCE_MS);
};

/** boot: claim after the save has synced, after a title unlocks (the push that carries it ends 'synced'), and after a wallet refresh */
export function initTitleRewards() {
  if (started || !wallet.enabled) return;
  started = true;
  cloud.on('status', () => {
    if (cloud.status !== 'synced') return;
    asked = ''; // the server may hold a newer save now
    schedule();
  });
  wallet.on(schedule);
  addEventListener('online', schedule);
  void wallet.refresh();
  schedule();
}
