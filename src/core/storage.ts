// src/core/storage.ts: shim; replaced by the feat/capacitor implementation at merge.
// Synchronous string key/value store. All new persisted client state goes through it.
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, val: string): void {
    try {
      localStorage.setItem(key, val);
    } catch {
      /* private mode */
    }
  },
};
