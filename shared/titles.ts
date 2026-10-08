/**
 * Titles (ฉายา / 称号): pure data. Each title is one row; how a requirement is measured lives in
 * src/core/meta.ts (client) and its sentence is generated there from `req`, so adding a title never needs new code
 * unless it introduces a new requirement kind.
 *
 * Rules for this file: pure TypeScript only (it is compiled into both the client and the Workers runtime), and ids
 * must match LIMITS.titlePattern in shared/api.ts. Order within a family is the progression order shown in the UI.
 */

/** lifetime counters a title can ask for (src/core/store.ts Stats, plus two derived ones) */
export type TitleStat = 'perfect' | 'bestCombo' | 'correct' | 'wrong' | 'games' | 'pulls' | 'maxCoins' | 'legendary' | 'mythic';

export type TitleReq =
  | { k: 'none' }
  | { k: 'level'; n: number }
  /** distinct words collected, any HSK level */
  | { k: 'owned'; n: number }
  /** every word of one HSK level */
  | { k: 'hsk'; n: number }
  /** every word of every HSK level */
  | { k: 'all' }
  /** best login streak */
  | { k: 'streak'; n: number }
  /** words seen at least 5 times and answered right at least 80% of the time */
  | { k: 'mastered'; n: number }
  /** distinct cosmetics owned (the cached inventory; 0 while it is unknown) */
  | { k: 'cosmetics'; n: number }
  /** completed cosmetic sets (all gacha members owned; bonus badges do not count; the cached inventory, 0 while unknown) */
  | { k: 'sets'; n: number }
  | { k: 'stat'; key: TitleStat; n: number };

export type TitleFamily = 'level' | 'collection' | 'hsk' | 'skill' | 'streak' | 'fortune';

export interface TitleDef {
  id: string;
  zh: string;
  en: string;
  th: string;
  /** visual tier 0..4, reuses the rarity colours */
  tier: 0 | 1 | 2 | 3 | 4;
  family: TitleFamily;
  req: TitleReq;
}

export const TITLE_FAMILIES: { id: TitleFamily; zh: string; en: string; th: string }[] = [
  { id: 'level', zh: '修为', en: 'Level', th: 'เลเวล' },
  { id: 'collection', zh: '藏书', en: 'Collection', th: 'การสะสม' },
  { id: 'hsk', zh: '等级', en: 'HSK Complete', th: 'พิชิต HSK' },
  { id: 'skill', zh: '技艺', en: 'Skill & Effort', th: 'ฝีมือและความพยายาม' },
  { id: 'streak', zh: '恒心', en: 'Streak', th: 'เข้าเล่นต่อเนื่อง' },
  { id: 'fortune', zh: '财运', en: 'Fortune', th: 'โชคลาภ' },
];

const T = (id: string, zh: string, en: string, th: string, tier: TitleDef['tier'], family: TitleFamily, req: TitleReq): TitleDef => ({ id, zh, en, th, tier, family, req });

export const TITLE_DEFS: TitleDef[] = [
  // ---- level
  T('novice', '初学者', 'Novice', 'มือใหม่หัดจีน', 0, 'level', { k: 'none' }),
  T('inkling', '墨童', 'Ink Apprentice', 'ศิษย์น้ำหมึก', 0, 'level', { k: 'level', n: 3 }),
  T('scholar', '书生', 'Scholar', 'บัณฑิตหนุ่ม', 1, 'level', { k: 'level', n: 5 }),
  T('brush', '笔仙', 'Brush Sage', 'เซียนพู่กัน', 2, 'level', { k: 'level', n: 10 }),
  T('adept', '高手', 'Adept', 'ยอดฝีมือ', 3, 'level', { k: 'level', n: 15 }),
  T('master', '汉字大师', 'Hanzi Master', 'ปรมาจารย์อักษร', 4, 'level', { k: 'level', n: 20 }),
  T('sage', '贤者', 'Sage', 'ปราชญ์ผู้รอบรู้', 4, 'level', { k: 'level', n: 30 }),
  T('immortal', '仙人', 'Immortal', 'เซียนสวรรค์', 4, 'level', { k: 'level', n: 50 }),

  // ---- collection
  T('collector', '藏家', 'Collector', 'นักสะสม', 1, 'collection', { k: 'owned', n: 50 }),
  T('bookworm', '书虫', 'Bookworm', 'หนอนหนังสือ', 1, 'collection', { k: 'owned', n: 100 }),
  T('archivist', '典藏家', 'Archivist', 'ผู้รักษาตำรา', 2, 'collection', { k: 'owned', n: 250 }),
  T('librarian', '藏经阁主', 'Keeper of Scrolls', 'ผู้พิทักษ์คัมภีร์', 3, 'collection', { k: 'owned', n: 500 }),
  T('erudite', '博学', 'Erudite', 'พหูสูต', 4, 'collection', { k: 'owned', n: 1000 }),
  T('grandarchive', '大藏经', 'Grand Archive', 'ผู้ครอบครองตำราทั้งปวง', 4, 'collection', { k: 'all' }),

  // ---- every word of an HSK level
  T('hsk1', '入门圆满', 'HSK 1 Complete', 'พิชิต HSK 1', 2, 'hsk', { k: 'hsk', n: 1 }),
  T('hsk2', '初阶圆满', 'HSK 2 Complete', 'พิชิต HSK 2', 2, 'hsk', { k: 'hsk', n: 2 }),
  T('hsk3', '进阶圆满', 'HSK 3 Complete', 'พิชิต HSK 3', 2, 'hsk', { k: 'hsk', n: 3 }),
  T('hsk4', '中阶圆满', 'HSK 4 Complete', 'พิชิต HSK 4', 3, 'hsk', { k: 'hsk', n: 4 }),
  T('hsk5', '高阶圆满', 'HSK 5 Complete', 'พิชิต HSK 5', 3, 'hsk', { k: 'hsk', n: 5 }),
  T('hsk6', '登峰造极', 'Summit', 'ถึงจุดสูงสุด HSK 6', 4, 'hsk', { k: 'hsk', n: 6 }),

  // ---- skill & effort
  T('regular', '常客', 'Regular', 'ขาประจำ', 0, 'skill', { k: 'stat', key: 'games', n: 50 }),
  T('veteran', '身经百战', 'Battle-Hardened', 'ผ่านร้อยสนามรบ', 3, 'skill', { k: 'stat', key: 'games', n: 500 }),
  T('neverdie', '屡败屡战', 'Never Say Die', 'ล้มแล้วลุก', 0, 'skill', { k: 'stat', key: 'wrong', n: 100 }),
  T('warmup', '热身', 'Warming Up', 'เริ่มอุ่นเครื่อง', 0, 'skill', { k: 'stat', key: 'correct', n: 100 }),
  T('forged', '千锤百炼', 'Well-Forged', 'ตีเหล็กตอนร้อน', 2, 'skill', { k: 'stat', key: 'correct', n: 1000 }),
  T('tenthousand', '万象', 'Ten Thousand', 'หมื่นคำตอบ', 4, 'skill', { k: 'stat', key: 'correct', n: 10000 }),
  T('sharp', '百发百中', 'Sharpshooter', 'แม่นเหมือนจับวาง', 1, 'skill', { k: 'stat', key: 'perfect', n: 1 }),
  T('perfect10', '完美主义', 'Perfectionist', 'สายเพอร์เฟกต์', 2, 'skill', { k: 'stat', key: 'perfect', n: 10 }),
  T('flawless', '无瑕', 'Flawless', 'ไร้ที่ติ', 3, 'skill', { k: 'stat', key: 'perfect', n: 50 }),
  T('combo15', '闪电', 'Lightning', 'สายฟ้าแลบ', 1, 'skill', { k: 'stat', key: 'bestCombo', n: 15 }),
  T('combo', '连击王', 'Combo King', 'ราชาคอมโบ', 2, 'skill', { k: 'stat', key: 'bestCombo', n: 30 }),
  T('combo50', '连击神', 'Combo God', 'เทพคอมโบ', 3, 'skill', { k: 'stat', key: 'bestCombo', n: 50 }),
  T('combo100', '无尽连击', 'Unbroken', 'ไม่มีวันขาด', 4, 'skill', { k: 'stat', key: 'bestCombo', n: 100 }),
  T('fluent', '熟能生巧', 'Practice Makes Perfect', 'ชำนาญจนเป็นธรรมชาติ', 2, 'skill', { k: 'mastered', n: 50 }),
  T('versed', '通晓', 'Well-Versed', 'พูดจีนคล่องปรื๋อ', 4, 'skill', { k: 'mastered', n: 500 }),

  // ---- login streak
  T('streak3', '三日', 'Warming Streak', 'เริ่มติดลม', 0, 'streak', { k: 'streak', n: 3 }),
  T('streak7', '恒心', 'Steadfast', 'ใจเด็ด 7 วัน', 2, 'streak', { k: 'streak', n: 7 }),
  T('streak14', '半月', 'Fortnight', 'ครึ่งเดือนไม่ขาด', 2, 'streak', { k: 'streak', n: 14 }),
  T('streak30', '持之以恒', 'Unwavering', 'ไฟไม่มอด', 3, 'streak', { k: 'streak', n: 30 }),
  T('streak100', '百日', 'Centurion', 'ร้อยวันไม่ร้าง', 4, 'streak', { k: 'streak', n: 100 }),
  T('streak365', '岁岁', 'Full Year', 'หนึ่งปีเต็ม', 4, 'streak', { k: 'streak', n: 365 }),

  // ---- gacha & coins
  T('lucky', '初试手气', 'Lucky Start', 'ลองเสี่ยงดวง', 0, 'fortune', { k: 'stat', key: 'pulls', n: 50 }),
  T('whale', '豪客', 'High Roller', 'สายเปย์', 3, 'fortune', { k: 'stat', key: 'pulls', n: 200 }),
  T('gamblergod', '赌神', 'Gacha God', 'เซียนกาชา', 4, 'fortune', { k: 'stat', key: 'pulls', n: 1000 }),
  T('golden', '金手指', 'Golden Touch', 'มือทอง', 3, 'fortune', { k: 'stat', key: 'legendary', n: 5 }),
  T('chosen', '天选之人', 'The Chosen One', 'ผู้ถูกเลือก', 4, 'fortune', { k: 'stat', key: 'mythic', n: 1 }),
  T('mythichunter', '神话猎人', 'Mythic Hunter', 'นักล่าตำนาน', 4, 'fortune', { k: 'stat', key: 'mythic', n: 3 }),
  T('wealth', '财神爷', 'God of Wealth', 'เทพเจ้าแห่งโชคลาภ', 3, 'fortune', { k: 'stat', key: 'maxCoins', n: 5000 }),
  T('wardrobe', '衣橱', 'Wardrobe', 'ตู้เสื้อผ้าล้น', 2, 'fortune', { k: 'cosmetics', n: 25 }),
  T('fullset', '套装', 'Full Set', 'ครบเซ็ต', 3, 'fortune', { k: 'sets', n: 1 }),
  T('rich', '富翁', 'Tycoon', 'เศรษฐีเหรียญ', 4, 'fortune', { k: 'stat', key: 'maxCoins', n: 20000 }),
];
