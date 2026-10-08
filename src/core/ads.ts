/**
 * Rewarded ads (AdMob, native apps only). The reward is granted by the server, not here: the ad carries the run
 * ticket as SSV custom data, AdMob calls GET /ads/admob-ssv, and POST /runs/continue claims it (server/continues.ts).
 *
 * Ad unit ids come from VITE_ADMOB_REWARDED_IOS / VITE_ADMOB_REWARDED_ANDROID (.env.production). Without one a
 * production build shows no ads on that platform (continues cost Jade). Dev builds and VITE_ADMOB_TEST=1 builds use
 * Google's test units, which never call back, so a local server needs ADS_SSV_BYPASS=1 in .dev.vars.
 *
 * Consent (Google UMP, EEA/UK) and the iOS tracking prompt are asked the first time the player taps "Watch ad".
 */
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';

const TEST_UNITS: Record<string, string> = {
  ios: 'ca-app-pub-3940256099942544/1712485313',
  android: 'ca-app-pub-3940256099942544/5224354917',
};
const PLATFORM = Capacitor.getPlatform();
const CONFIGURED = (PLATFORM === 'ios' ? import.meta.env.VITE_ADMOB_REWARDED_IOS : PLATFORM === 'android' ? import.meta.env.VITE_ADMOB_REWARDED_ANDROID : '')?.trim();
/** dev builds, and any build made with VITE_ADMOB_TEST=1, use Google's test units: never tap a live ad of your own */
const FORCE_TEST = import.meta.env.DEV || import.meta.env.VITE_ADMOB_TEST === '1';
const UNIT = Capacitor.isNativePlatform() ? (FORCE_TEST ? TEST_UNITS[PLATFORM] : CONFIGURED) || '' : '';
const TESTING = !!UNIT && UNIT === TEST_UNITS[PLATFORM];

const LOAD_TIMEOUT_MS = 12_000;

type AdMobModule = typeof import('@capacitor-community/admob');

let mod: Promise<AdMobModule> | null = null;
let setup: Promise<boolean> | null = null;
/** the loaded ad and the custom data it was loaded with (SSV custom data is fixed at load time) */
let loaded: { custom: string; p: Promise<boolean> } | null = null;

const admob = () => (mod ??= import('@capacitor-community/admob'));

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);

/** initialize once: SDK, consent form when required, then the iOS tracking prompt. false = no ads on this device. */
function init(): Promise<boolean> {
  return (setup ??= (async () => {
    try {
      const { AdMob, AdmobConsentStatus } = await admob();
      await AdMob.initialize({ initializeForTesting: TESTING });
      let info = await AdMob.requestConsentInfo();
      if (info.status === AdmobConsentStatus.REQUIRED && info.isConsentFormAvailable) info = await AdMob.showConsentForm();
      if (PLATFORM === 'ios') {
        const { status } = await AdMob.trackingAuthorizationStatus();
        if (status === 'notDetermined') await AdMob.requestTrackingAuthorization();
      }
      return info.canRequestAds;
    } catch (e) {
      console.warn('[ads] init failed', e);
      setup = null; // try again next time
      return false;
    }
  })());
}

function load(custom: string): Promise<boolean> {
  if (loaded?.custom === custom) return loaded.p;
  const p = (async () => {
    try {
      const { AdMob } = await admob();
      await AdMob.prepareRewardVideoAd({ adId: UNIT, isTesting: TESTING, ssv: { customData: custom } });
      return true;
    } catch (e) {
      console.warn('[ads] load failed', e);
      return false;
    }
  })();
  loaded = { custom, p };
  void p.then((ok) => {
    if (!ok && loaded?.p === p) loaded = null;
  });
  return p;
}

export type AdResult = 'rewarded' | 'skipped' | 'failed';

export const ads = {
  /** this build can show rewarded ads (a native app with an ad unit) */
  get available(): boolean {
    return !!UNIT;
  },

  /** load an ad ahead of time, only if the player already went through consent (never prompts) */
  preload(custom: string) {
    if (!UNIT || !setup) return;
    void setup.then((ok) => ok && load(custom));
  },

  /** shows a rewarded ad. 'rewarded' means the player earned it; the server still has to see AdMob's callback. */
  async show(custom: string): Promise<AdResult> {
    if (!UNIT || !(await init())) return 'failed';
    if (!(await withTimeout(load(custom), LOAD_TIMEOUT_MS, false))) return 'failed';
    loaded = null; // one show per load
    const { AdMob, RewardAdPluginEvents } = await admob();
    let rewarded = false;
    let failed = false;
    let close!: () => void;
    const closed = new Promise<void>((res) => (close = res));
    const subs: PluginListenerHandle[] = [];
    try {
      subs.push(
        await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => (rewarded = true)),
        await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => close()),
        await AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => ((failed = true), close())),
      );
      // the show call resolves when the reward is earned (the ad is still on screen), and on Android never settles
      // when the player closes the ad early: wait for the dismissal instead
      AdMob.showRewardVideoAd().then(
        () => (rewarded = true),
        (e) => {
          console.warn('[ads] show failed', e);
          failed = true;
          close();
        },
      );
      await closed;
    } finally {
      for (const s of subs) void s.remove();
    }
    return rewarded ? 'rewarded' : failed ? 'failed' : 'skipped';
  },
};
