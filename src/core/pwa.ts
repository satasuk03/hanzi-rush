/**
 * Web install (PWA). Decides which install path this browser has and whether today's offer is due.
 *   native     the Capacitor app: never offered
 *   installed  running from the home screen, or installed earlier from this browser: never offered again
 *   prompt     Chrome/Edge/Samsung on Android fired beforeinstallprompt: one tap installs
 *   android    Android without the prompt (Firefox, prompt not ready yet): menu steps
 *   ios        iPhone/iPad Safari: Share → Add to Home Screen steps
 *   inApp      an in-app browser (LINE, Facebook, Instagram) can't install: open in the browser first
 *   none       desktop or anything else: never offered
 * Android's installed app shares this browser's storage, so marking it installed from inside the app also silences
 * the offer in the browser. An iOS home-screen app has its own storage and can't tell Safari.
 */
import { Capacitor } from '@capacitor/core';

export type InstallPath = 'native' | 'installed' | 'prompt' | 'android' | 'ios' | 'inApp' | 'none';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const INSTALLED = 'hanzi-rush:pwa-installed';
const OFFERED = 'hanzi-rush:pwa-offered';

const ls = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* private mode */
    }
  },
};

const today = () => new Date().toDateString();
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const isInApp = /\bLine\/|FBAN|FBAV|Instagram|TikTok|musical_ly/i.test(ua);
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

let deferred: InstallPromptEvent | null = null;
const ready = new Set<() => void>();

export const pwa = {
  /** call at boot, before beforeinstallprompt can fire */
  init() {
    if (Capacitor.isNativePlatform()) return;
    if (standalone()) ls.set(INSTALLED, '1');
    addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e as InstallPromptEvent;
      // Chrome only offers this while the app isn't installed, so an uninstalled app gets the daily offer back
      if (!standalone()) ls.del(INSTALLED);
      ready.forEach((f) => f());
    });
    addEventListener('appinstalled', () => {
      deferred = null;
      ls.set(INSTALLED, '1');
    });
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
    }
  },

  path(): InstallPath {
    if (Capacitor.isNativePlatform()) return 'native';
    if (standalone() || ls.get(INSTALLED)) return 'installed';
    if (deferred) return 'prompt';
    if (isInApp && (isIOS || isAndroid)) return 'inApp';
    if (isIOS) return 'ios';
    if (isAndroid) return 'android';
    return 'none';
  },

  /** Chrome fires beforeinstallprompt a moment after load: lets an open modal swap its steps for the button */
  onPrompt(f: () => void) {
    ready.add(f);
    return () => ready.delete(f);
  },

  /** true once per calendar day while the game runs in a browser tab that could install it */
  due() {
    return ['prompt', 'android', 'ios', 'inApp'].includes(pwa.path()) && ls.get(OFFERED) !== today();
  },

  markOffered() {
    ls.set(OFFERED, today());
  },

  /** shows the browser's own install sheet; resolves true when the player accepts */
  async prompt() {
    const e = deferred;
    if (!e) return false;
    deferred = null;
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === 'accepted') ls.set(INSTALLED, '1');
    return outcome === 'accepted';
  },
};
