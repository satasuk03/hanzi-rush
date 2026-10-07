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
  clozeName: { en: 'Cloze Rush', th: 'เติมคำในประโยค' },
  clozeDesc: { en: 'Fill the missing word in the sentence!', th: 'เติมคำที่หายไปในประโยค!' },
  clozeRibbon: { en: 'FILL THE BLANK', th: 'เติมคำในช่องว่าง' },
  clozeMeans: { en: 'means', th: 'แปลว่า' },
  pinyinName: { en: 'Pinyin Pop', th: 'พินอินป๊อป' },
  toneName: { en: 'Tone Hero', th: 'ฮีโร่วรรณยุกต์' },
  strokeName: { en: 'Stroke Master', th: 'เซียนขีดอักษร' },
  listenName: { en: 'Listen & Catch', th: 'ฟังแล้วจับ' },
  question: { en: 'Q', th: 'ข้อ' },
  // ---- vault (gacha) · collection · profile
  vaultName: { en: 'Hanzi Gacha', th: 'กาชาคำศัพท์' },
  vaultDesc: { en: 'Spend coins, collect rare words', th: 'ใช้เหรียญเปิดตู้ สะสมคำหายาก' },
  vaultTitle: { en: 'Treasure Vault', th: 'ตู้สมบัติคำศัพท์' },
  open: { en: 'OPEN', th: 'เปิด' },
  collection: { en: 'Collection', th: 'สมุดสะสม' },
  profile: { en: 'Profile', th: 'โปรไฟล์' },
  dailyTitle: { en: 'Daily Login', th: 'เช็คอินรายวัน' },
  dailyStreak: { en: 'day streak', th: 'วันติดต่อกัน' },
  dailyDay: { en: 'Day', th: 'วันที่' },
  dailyClaim: { en: 'CLAIM', th: 'รับรางวัล' },
  dailyHint: { en: 'Come back tomorrow to keep your streak!', th: 'พรุ่งนี้มาเล่นต่อ เพื่อรักษา streak!' },
  rates: { en: 'Drop rates', th: 'อัตราการออก' },
  pityA: { en: 'LEGENDARY+ guaranteed within', th: 'การันตี LEGENDARY+ ภายใน' },
  pityB: { en: 'pulls', th: 'ครั้ง' },
  tenDeal: { en: '×10: 1 free + EPIC+ guaranteed', th: '×10: แถมฟรี 1 + การันตี EPIC+' },
  notEnough: { en: 'Not enough coins. Play a game to earn more!', th: 'เหรียญไม่พอ ไปเล่นเกมหาเหรียญก่อนนะ!' },
  tapReveal: { en: 'Tap to reveal', th: 'แตะเพื่อเปิดการ์ด' },
  tapNext: { en: 'Tap for next card', th: 'แตะเพื่อดูใบถัดไป' },
  skip: { en: 'Skip', th: 'ข้าม' },
  newCard: { en: 'NEW', th: 'ใหม่' },
  duplicate: { en: 'Duplicate', th: 'ซ้ำ' },
  again: { en: 'Open again', th: 'เปิดอีก' },
  done: { en: 'Done', th: 'เสร็จ' },
  collected: { en: 'Collected', th: 'สะสมแล้ว' },
  all: { en: 'All', th: 'ทั้งหมด' },
  owned: { en: 'Owned', th: 'มีแล้ว' },
  missing: { en: 'Missing', th: 'ยังไม่มี' },
  notCollected: { en: 'Not collected yet. Open this HSK vault to find it!', th: 'ยังไม่ได้สะสม ไปเปิดตู้ HSK นี้เพื่อตามหา!' },
  copies: { en: 'Copies', th: 'จำนวนใบ' },
  level: { en: 'Level', th: 'เลเวล' },
  levelUp: { en: 'LEVEL UP!', th: 'เลเวลอัป!' },
  titles: { en: 'Titles', th: 'ฉายา' },
  equip: { en: 'Equip', th: 'ใส่' },
  equipped: { en: 'Equipped', th: 'ใส่อยู่' },
  titleUnlocked: { en: 'New title unlocked', th: 'ปลดล็อกฉายาใหม่' },
  titlesMany: { en: '{n} new titles! See your profile', th: 'ฉายาใหม่ {n} ฉายา! ดูที่โปรไฟล์' },
  titlesNextUp: { en: 'Next up', th: 'ใกล้ปลดล็อก' },
  statGames: { en: 'Games played', th: 'เกมที่เล่น' },
  statCorrect: { en: 'Correct answers', th: 'ตอบถูก' },
  statPulls: { en: 'Cards opened', th: 'การ์ดที่เปิด' },
  statWords: { en: 'Words collected', th: 'คำที่สะสม' },
  statCoins: { en: 'Coins earned', th: 'เหรียญที่หาได้' },
  statPerfect: { en: 'Perfect runs', th: 'รอบไร้ที่ติ' },
  statXp: { en: 'Total XP', th: 'XP ทั้งหมด' },
  playerName: { en: 'Player', th: 'ผู้เล่น' },
  rewards: { en: 'Rewards', th: 'รางวัล' },
  byLevel: { en: 'By HSK level', th: 'แยกตามระดับ HSK' },
  byRarity: { en: 'By rarity', th: 'แยกตามความหายาก' },
  firstFound: { en: 'First found', th: 'ได้ครั้งแรก' },
  listen: { en: 'Listen', th: 'ฟังเสียง' },
  close: { en: 'Close', th: 'ปิด' },
  complete: { en: 'All collected. Amazing!', th: 'สะสมครบแล้ว สุดยอด!' },
  // ---- leaderboard · cloud save
  leaderboard: { en: 'Leaderboard', th: 'กระดานผู้นำ' },
  lbAll: { en: 'All-time', th: 'ตลอดกาล' },
  lbWeek: { en: 'This week', th: 'สัปดาห์นี้' },
  lbDay: { en: 'Today', th: 'วันนี้' },
  lbResets: { en: 'Resets in', th: 'รีเซ็ตใน' },
  lbYou: { en: 'You', th: 'คุณ' },
  lbEmpty: { en: 'No scores yet. Be the first!', th: 'ยังไม่มีใครทำคะแนน เป็นคนแรกเลย!' },
  lbUnranked: { en: 'Finish a run to get ranked', th: 'เล่นจบหนึ่งรอบเพื่อติดอันดับ' },
  lbOffline: { en: 'Offline. Tap to retry.', th: 'ออฟไลน์อยู่ แตะเพื่อลองใหม่' },
  lbRankDay: { en: 'today', th: 'วันนี้' },
  lbRankAll: { en: 'all-time', th: 'ตลอดกาล' },
  lbUnverified: { en: 'unverified', th: 'ยังไม่ยืนยัน' },
  effortTitle: { en: 'Dedication', th: 'ความขยัน' },
  effortSub: { en: 'Most correct answers', th: 'ตอบถูกมากที่สุด' },
  effortUnit: { en: 'correct', th: 'ข้อถูก' },
  effortRuns: { en: 'rounds', th: 'รอบ' },
  effortEmpty: { en: 'Nobody yet. Play a round to be first!', th: 'ยังไม่มีใคร เล่นหนึ่งรอบเพื่อเป็นคนแรก!' },
  effortJoin: { en: 'Finish a round to join', th: 'เล่นจบหนึ่งรอบเพื่อเข้าร่วม' },
  effortWeekRank: { en: 'this week', th: 'สัปดาห์นี้' },
  cloudSave: { en: 'Cloud save', th: 'เซฟบนคลาวด์' },
  cloudSynced: { en: 'Synced', th: 'ซิงก์แล้ว' },
  cloudSyncing: { en: 'Syncing…', th: 'กำลังซิงก์…' },
  cloudOffline: { en: 'Offline. Will sync later.', th: 'ออฟไลน์ จะซิงก์ให้ทีหลัง' },
  cloudPending: { en: 'Waiting to sync', th: 'รอซิงก์' },
  cloudDisabled: { en: 'Cloud save is off', th: 'เซฟบนคลาวด์ปิดอยู่' },
  cloudEnable: { en: 'Turn on cloud save', th: 'เปิดเซฟบนคลาวด์' },
  codeReplaced: { en: 'This code was replaced on another device. Make a new code to get a working one.', th: 'รหัสนี้ถูกเปลี่ยนจากอีกเครื่องแล้ว สร้างรหัสใหม่เพื่อใช้งานได้' },
  codeUnknown: { en: 'A code exists but isn’t saved on this device. Make a new code to see one. The old code will stop working.', th: 'มีรหัสอยู่แล้วแต่ไม่ได้เก็บไว้ในเครื่องนี้ สร้างรหัสใหม่เพื่อดูรหัส รหัสเก่าจะใช้ไม่ได้' },
  newCodeWarn: { en: 'Make a new code? The old code will stop working.', th: 'สร้างรหัสใหม่ใช่ไหม? รหัสเก่าจะใช้ไม่ได้อีก' },
  signOutOthers: { en: 'Also sign out other devices', th: 'ออกจากระบบเครื่องอื่นด้วย' },
  cancel: { en: 'Cancel', th: 'ยกเลิก' },
  transferCode: { en: 'Transfer code', th: 'รหัสย้ายเครื่อง' },
  transferHint: { en: 'Enter this code on a new device to restore your progress. Keep it secret!', th: 'ใส่รหัสนี้ในเครื่องใหม่เพื่อกู้ความคืบหน้า ห้ามบอกใครนะ!' },
  newCode: { en: 'New code', th: 'สร้างรหัสใหม่' },
  copy: { en: 'Copy', th: 'คัดลอก' },
  copied: { en: 'Copied!', th: 'คัดลอกแล้ว!' },
  restore: { en: 'Restore progress', th: 'กู้ความคืบหน้า' },
  restoreHint: { en: 'Enter the transfer code from your other device', th: 'ใส่รหัสย้ายเครื่องจากเครื่องเดิม' },
  restoreBad: { en: 'That code doesn’t work', th: 'รหัสนี้ใช้ไม่ได้' },
  restoreOk: { en: 'Welcome back!', th: 'ยินดีต้อนรับกลับมา!' },
  restoreAsk: { en: 'This device has progress too. What should we do?', th: 'เครื่องนี้ก็มีความคืบหน้าอยู่ จะทำอย่างไรดี?' },
  restoreCombine: { en: 'Combine both', th: 'รวมทั้งสองเครื่อง' },
  restoreCloudOnly: { en: 'Use restored only', th: 'ใช้ของที่กู้มาอย่างเดียว' },
  tooMany: { en: 'Too many tries. Try again later.', th: 'ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่' },
  deleteAccount: { en: 'Delete cloud account', th: 'ลบบัญชีบนคลาวด์' },
  deleteWarn: { en: 'This erases your cloud save and leaderboard scores. Progress on this device is kept.', th: 'จะลบเซฟบนคลาวด์และคะแนนในกระดานผู้นำ ความคืบหน้าในเครื่องนี้ยังอยู่' },
  deleteYes: { en: 'Delete', th: 'ลบเลย' },
  deleteDone: { en: 'Account deleted', th: 'ลบบัญชีแล้ว' },
  signedOutTitle: { en: 'Signed out on this device', th: 'ออกจากระบบในเครื่องนี้แล้ว' },
  signedOutBody: { en: 'Enter your transfer code to reconnect, or start a new cloud save. Progress on this device is kept.', th: 'ใส่รหัสย้ายเครื่องเพื่อเชื่อมต่อใหม่ หรือเริ่มเซฟบนคลาวด์ใหม่ ความคืบหน้าในเครื่องนี้ยังอยู่' },
  signedOutEnter: { en: 'Enter code', th: 'ใส่รหัส' },
  signedOutNew: { en: 'New cloud save', th: 'เริ่มเซฟคลาวด์ใหม่' },
  cloudSignedOut: { en: 'Signed out on this device. Enter your transfer code to reconnect, or start a new cloud save.', th: 'ออกจากระบบในเครื่องนี้แล้ว ใส่รหัสย้ายเครื่องเพื่อเชื่อมต่อใหม่ หรือเริ่มเซฟบนคลาวด์ใหม่' },
  namePromptTitle: { en: 'Pick a name for the leaderboard', th: 'ตั้งชื่อสำหรับกระดานผู้นำ' },
  namePromptHint: { en: 'Others will see this next to your score. You can change it later in your profile.', th: 'คนอื่นจะเห็นชื่อนี้ข้างคะแนนของคุณ เปลี่ยนทีหลังได้ในโปรไฟล์' },
  nameSave: { en: 'Save', th: 'บันทึก' },
  nameLater: { en: 'Later', th: 'ไว้ทีหลัง' },
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
