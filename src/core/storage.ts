/**
 * Sync key/value store with an in-memory cache.
 * Web: straight to localStorage. Native: @capacitor/preferences is the source of truth
 * (WebView localStorage can be evicted by the OS); init() hydrates the cache before the store loads.
 * Migration: a key missing from Preferences but present in localStorage is copied over once
 * (localStorage is left untouched as a harmless backup).
 */
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const native = Capacitor.isNativePlatform();
const cache = new Map<string, string>();
// keys migrated from localStorage on first native launch; Preferences keys are all hydrated regardless
const MIGRATE = ['hanzi-rush:v1'];

const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable (private mode) */
    }
  },
};

export const storage = {
  async init() {
    if (!native) return;
    try {
      const { keys } = await Preferences.keys();
      for (const k of keys) {
        const v = (await Preferences.get({ key: k })).value;
        if (v != null) cache.set(k, v);
      }
      for (const k of MIGRATE) {
        const v = ls.get(k);
        if (cache.has(k) || v == null) continue;
        cache.set(k, v);
        await Preferences.set({ key: k, value: v });
      }
    } catch {
      /* fall back to defaults */
    }
  },
  get(key: string): string | null {
    return native ? (cache.get(key) ?? null) : ls.get(key);
  },
  set(key: string, value: string) {
    if (!native) return ls.set(key, value);
    cache.set(key, value);
    Preferences.set({ key, value }).catch(() => {});
  },
};
