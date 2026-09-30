export interface Word {
  /** simplified hanzi */
  h: string;
  /** pinyin with tone marks */
  p: string;
  en: string;
  th: string;
  ex: { zh: string; py: string; en: string; th: string };
}

export interface LevelMeta {
  n: number;
  count: number;
  color: string;
  dark: string;
  sample: string;
}

export const LEVELS: LevelMeta[] = [
  { n: 1, count: 150, color: '#5be35b', dark: '#23a63a', sample: '你好' },
  { n: 2, count: 147, color: '#1fd1c1', dark: '#0e9488', sample: '朋友' },
  { n: 3, count: 298, color: '#3da5ff', dark: '#1c6fd1', sample: '文化' },
  { n: 4, count: 598, color: '#9b6bff', dark: '#6a3fd6', sample: '经验' },
  { n: 5, count: 1298, color: '#ff5fa2', dark: '#d02f74', sample: '智慧' },
  { n: 6, count: 2500, color: '#ff9a1f', dark: '#d9650a', sample: '炉火纯青' },
];

const cache = new Map<number, Promise<Word[]>>();

export function loadLevel(n: number): Promise<Word[]> {
  let p = cache.get(n);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/hsk${n}.json`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<Word[]>;
    });
    p.catch(() => cache.delete(n));
    cache.set(n, p);
  }
  return p;
}
