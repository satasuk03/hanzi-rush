/** Sync key/value store backed straight by localStorage. */

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
  get(key: string): string | null {
    return ls.get(key);
  },
  set(key: string, value: string) {
    ls.set(key, value);
  },
};
