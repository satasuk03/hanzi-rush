import { store } from './store';

export type Lang = 'th' | 'en';

const dict = {
  tagline: { en: 'Learn Chinese. Get the rush.', th: 'เรียนจีนให้มันส์ สะใจทุกคำ' },
  games: { en: 'Games', th: 'เกม' },
  play: { en: 'PLAY', th: 'เล่น' },
  comingSoon: { en: 'Coming soon', th: 'เร็วๆ นี้' },
  chooseLevel: { en: 'Choose HSK level', th: 'เลือกระดับ HSK' },
  words: { en: 'words', th: 'คำ' },
  best: { en: 'Best', th: 'สูงสุด' },
  back: { en: 'Back', th: 'กลับ' },
  loading: { en: 'Loading…', th: 'กำลังโหลด…' },
  loadFail: { en: 'Could not load words. Tap to retry.', th: 'โหลดคำศัพท์ไม่ได้ แตะเพื่อลองใหม่' },
  modeRush: { en: 'Rush', th: 'บุก' },
  modeRushDesc: { en: '3 lives · timer · endless', th: '3 ชีวิต · จับเวลา · ไม่มีที่สิ้นสุด' },
  modeZen: { en: 'Practice', th: 'ฝึกซ้อม' },
  modeZenDesc: { en: '20 questions · no pressure', th: '20 ข้อ · ไม่จับเวลา' },
  go: { en: 'GO!', th: 'ลุย!' },
  combo: { en: 'COMBO', th: 'คอมโบ' },
  fever: { en: 'FEVER', th: 'ฟีเวอร์' },
  feverTime: { en: 'FEVER TIME!', th: 'ฟีเวอร์ไทม์!' },
  timeUp: { en: "Time's up!", th: 'หมดเวลา!' },
  tapContinue: { en: 'Tap to continue', th: 'แตะเพื่อไปต่อ' },
  answer: { en: 'ANSWER', th: 'คำตอบ' },
  example: { en: 'Example', th: 'ตัวอย่าง' },
  paused: { en: 'Paused', th: 'หยุดชั่วคราว' },
  resume: { en: 'Resume', th: 'เล่นต่อ' },
  quit: { en: 'Quit', th: 'ออก' },
  gameOver: { en: 'GAME OVER', th: 'จบเกม' },
  finished: { en: 'FINISHED!', th: 'จบแล้ว!' },
  score: { en: 'Score', th: 'คะแนน' },
  accuracy: { en: 'Accuracy', th: 'ความแม่นยำ' },
  maxCombo: { en: 'Max combo', th: 'คอมโบสูงสุด' },
  correct: { en: 'Correct', th: 'ถูก' },
  newBest: { en: 'NEW BEST!', th: 'สถิติใหม่!' },
  missed: { en: 'Words to review', th: 'คำที่ควรทบทวน' },
  perfectRun: { en: 'No mistakes. Legendary!', th: 'ไม่ผิดเลย สุดยอดมาก!' },
  retry: { en: 'Again', th: 'อีกครั้ง' },
  levels: { en: 'Levels', th: 'ระดับ' },
  home: { en: 'Home', th: 'หน้าแรก' },
  sound: { en: 'Sound', th: 'เสียง' },
  pinyin: { en: 'Pinyin', th: 'พินอิน' },
  voice: { en: 'Voice', th: 'เสียงอ่าน' },
  settings: { en: 'Settings', th: 'ตั้งค่า' },
  quizName: { en: 'Meaning Rush', th: 'ทายความหมาย' },
  quizDesc: { en: 'Pick the right meaning, fast!', th: 'เลือกความหมายให้ถูก ให้ไว!' },
  pinyinName: { en: 'Pinyin Pop', th: 'พินอินป๊อป' },
  toneName: { en: 'Tone Hero', th: 'ฮีโร่วรรณยุกต์' },
  strokeName: { en: 'Stroke Master', th: 'เซียนขีดอักษร' },
  listenName: { en: 'Listen & Catch', th: 'ฟังแล้วจับ' },
  question: { en: 'Q', th: 'ข้อ' },
} as const;

export type Key = keyof typeof dict;

const listeners = new Set<() => void>();

export const i18n = {
  get lang(): Lang {
    return store.settings.lang;
  },
  set(lang: Lang) {
    store.settings.lang = lang;
    store.save();
    document.documentElement.lang = lang;
    document.body.classList.toggle('lang-th', lang === 'th');
    apply(document.body);
    listeners.forEach((f) => f());
  },
  onChange(f: () => void) {
    listeners.add(f);
    return () => listeners.delete(f);
  },
};

export const t = (k: Key) => dict[k][i18n.lang];

/** Create a text node-ish span that re-translates itself when the language changes. */
export function tx(k: Key, tag: keyof HTMLElementTagNameMap = 'span') {
  const el = document.createElement(tag);
  el.dataset.i18n = k;
  el.textContent = t(k);
  return el;
}

export function apply(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as Key);
  });
}

export const PRAISE: { zh: string; en: string; th: string }[] = [
  { zh: '好!', en: 'NICE!', th: 'ดีมาก!' },
  { zh: '很好!', en: 'GREAT!', th: 'เยี่ยม!' },
  { zh: '太棒了!', en: 'AWESOME!', th: 'สุดยอด!' },
  { zh: '厉害!', en: 'AMAZING!', th: 'เก่งมาก!' },
  { zh: '无敌!', en: 'UNSTOPPABLE!', th: 'ไร้เทียมทาน!' },
];
