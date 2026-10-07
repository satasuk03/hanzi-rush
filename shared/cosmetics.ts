/**
 * Cosmetics: slots, the item catalog and the box definitions (docs/cosmetics-shop.md §2, §11.6b).
 *
 * Rules for this file: pure TypeScript only (it is compiled into both the client and the Workers runtime) and it must
 * not import shared/api.ts (api.ts imports this file for sanitizeLook). Item ids are unique across slots, so the later
 * inventory can be keyed by id alone, and match ITEM_ID_RE.
 */

export const SLOTS = ['frame', 'avatar', 'nameFx', 'badge'] as const;
export type Slot = (typeof SLOTS)[number];

/** what a player wears. A missing slot is the default (avatar: the title glyph seal). */
export interface Look {
  frame?: string;
  avatar?: string;
  nameFx?: string;
  /** up to LOOK_MAX_BADGES distinct ids; board rows show only the first */
  badges?: string[];
}

export const LOOK_MAX_BADGES = 3;
/** serialized size cap of one look (it rides on every board row) */
export const LOOK_MAX_BYTES = 200;
export const ITEM_ID_RE = /^[a-z0-9_-]{1,24}$/;

/** 0 COMMON .. 4 MYTHIC, same indexes as RARITIES in src/core/rarity.ts */
export type RarityIdx = 0 | 1 | 2 | 3 | 4;

/** `gacha` drops from boxes; `grant` is server-verified (rank badges, Founder); `event` is limited or not yet released */
export type ItemSource = 'gacha' | 'grant' | 'event';

export interface Item {
  id: string;
  slot: Slot;
  rarity: RarityIdx;
  /** themed collection (set boxes, phase D) */
  set: string | null;
  source: ItemSource;
  zh: string;
  en: string;
  th: string;
}

const item = (id: string, slot: Slot, rarity: RarityIdx, zh: string, en: string, th: string, source: ItemSource = 'gacha'): Item => ({ id, slot, rarity, set: null, source, zh, en, th });

/**
 * The 30 avatars, in the order of assets/avatars/manifest.json. The image is `public/avatars/<id minus the
 * "avatar_" prefix>.webp` (see src/cosmetics/render.ts). Keep both lists in step when an avatar is added.
 */
const AVATARS: [id: string, zh: string, en: string, th: string, rarity: RarityIdx][] = [
  ['rabbit', '兔', 'Rabbit', 'กระต่าย', 0],
  ['rat', '鼠', 'Rat', 'หนู', 0],
  ['ox', '牛', 'Ox', 'วัว', 0],
  ['goat', '羊', 'Goat', 'แพะ', 0],
  ['rooster', '鸡', 'Rooster', 'ไก่', 0],
  ['dog', '狗', 'Dog', 'สุนัข', 0],
  ['pig', '猪', 'Pig', 'หมู', 0],
  ['dumpling', '饺', 'Dumpling', 'เกี๊ยว', 0],
  ['tea', '茶', 'Teacup', 'ถ้วยชา', 0],
  ['bamboo', '竹', 'Bamboo', 'ไผ่', 0],
  ['snake', '蛇', 'Snake', 'งู', 1],
  ['horse', '马', 'Horse', 'ม้า', 1],
  ['monkey', '猴', 'Monkey', 'ลิง', 1],
  ['panda', '熊', 'Panda', 'แพนด้า', 1],
  ['koi', '鲤', 'Koi', 'ปลาคาร์ป', 1],
  ['crane', '鹤', 'Crane', 'นกกระเรียน', 1],
  ['turtle', '龟', 'Turtle', 'เต่า', 1],
  ['cat', '猫', 'Lucky Cat', 'แมวกวัก', 1],
  ['tiger', '虎', 'Tiger', 'เสือ', 2],
  ['fox', '狐', 'Fox', 'จิ้งจอก', 2],
  ['lion', '狮', 'Lion Dancer', 'สิงโตเชิด', 2],
  ['lantern', '灯', 'Lantern', 'โคมไฟ', 2],
  ['lotus', '莲', 'Lotus', 'ดอกบัว', 2],
  ['brush', '笔', 'Brush Spirit', 'วิญญาณพู่กัน', 2],
  ['phoenix', '凤', 'Phoenix', 'หงส์เพลิง', 3],
  ['qilin', '麒', 'Qilin', 'ฉีหลิน', 3],
  ['wealth', '财', 'God of Wealth', 'ไฉ่ซิงเอี๊ย', 3],
  ['jaderabbit', '玉', 'Jade Rabbit', 'กระต่ายหยก', 3],
  ['dragon', '龙', 'Dragon', 'มังกร', 4],
  ['baize', '泽', 'Baize', 'ไป๋เจ๋อ', 4],
];

export const AVATAR_PREFIX = 'avatar_';

/**
 * PLACEHOLDERS for the frame, nameFx and badge slots: just enough for the renderer and the sanitizer to be exercised.
 * They are `event` items, so no box pool will ever pick them. The real set (about 14 frames, 12 name effects, 20
 * badges, §8) replaces them in phase C.
 */
const PLACEHOLDERS: Item[] = [
  item('frame_ph_bronze', 'frame', 0, '铜框', 'Bronze Frame', 'กรอบทองแดง', 'event'),
  item('frame_ph_gold', 'frame', 3, '金框', 'Gold Frame', 'กรอบทอง', 'event'),
  item('fx_ph_red', 'nameFx', 1, '朱红', 'Vermilion', 'แดงชาด', 'event'),
  item('fx_ph_gold', 'nameFx', 3, '流金', 'Gilded', 'ทองอร่าม', 'event'),
  item('badge_ph_star', 'badge', 0, '星', 'Star', 'ดาว', 'event'),
  item('badge_ph_gem', 'badge', 2, '宝', 'Gem', 'อัญมณี', 'event'),
];

export const ITEMS: readonly Item[] = [...AVATARS.map(([id, zh, en, th, r]) => item(AVATAR_PREFIX + id, 'avatar', r, zh, en, th)), ...PLACEHOLDERS];

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

export const itemById = (id: string): Item | undefined => BY_ID.get(id);

/** the item if `id` exists and belongs to `slot` */
export const itemInSlot = (id: unknown, slot: Slot): Item | undefined => {
  const it = typeof id === 'string' ? BY_ID.get(id) : undefined;
  return it && it.slot === slot ? it : undefined;
};

// ====================================================================== boxes

/** rates are percentages for COMMON..MYTHIC and add up to 100 */
export interface BoxDef {
  id: 'standard' | 'select' | 'supreme';
  zh: string;
  en: string;
  th: string;
  /** Jade per box */
  price: number;
  rates: readonly [number, number, number, number, number];
  /** hard pity: a LEGENDARY or better within this many boxes, counted per box type */
  pity: number;
  /** the box never drops anything below this rarity */
  minRarity: RarityIdx;
}

/** the rarity index the hard pity guarantees (LEGENDARY) */
export const PITY_RARITY: RarityIdx = 3;

export const BOXES: readonly BoxDef[] = [
  { id: 'standard', zh: '漆匣', en: 'Standard Box', th: 'กล่องธรรมดา', price: 100, rates: [55, 28, 12, 4, 1], pity: 30, minRarity: 0 },
  { id: 'select', zh: '银匣', en: 'Select Box', th: 'กล่องเงิน', price: 250, rates: [0, 60, 27, 10, 3], pity: 12, minRarity: 1 },
  { id: 'supreme', zh: '金匣', en: 'Supreme Box', th: 'กล่องทอง', price: 600, rates: [0, 0, 60, 30, 10], pity: 5, minRarity: 2 },
];

export const boxById = (id: string): BoxDef | undefined => BOXES.find((b) => b.id === id);

/** ×10 pays for 9 (the last pull is a guaranteed EPIC or better) */
export const BOX_MULTI = 10;
export const boxPrice = (b: BoxDef, qty: number): number => b.price * (qty >= BOX_MULTI ? qty - Math.floor(qty / BOX_MULTI) : qty);

/** Jade refunded for a duplicate, by item rarity (not by box price) */
export const DUPLICATE_REFUND: readonly number[] = [5, 10, 25, 50, 100];

// ====================================================================== sanitizing

/**
 * Canonical look cleanup, run on the server (authoritative) and by the renderer. Known slots only; every id must exist
 * in the catalog for its slot; badges are deduped and capped; anything invalid falls back to the default (dropped).
 * `grant` items are kept out until a grants table can vouch for them (phase E).
 */
export function sanitizeLook(raw: unknown): Look {
  const out: Look = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  const pick = (id: unknown, slot: Slot) => {
    const it = itemInSlot(id, slot);
    return it && it.source !== 'grant' ? it.id : undefined;
  };
  const frame = pick(r.frame, 'frame');
  if (frame) out.frame = frame;
  const avatar = pick(r.avatar, 'avatar');
  if (avatar) out.avatar = avatar;
  const nameFx = pick(r.nameFx, 'nameFx');
  if (nameFx) out.nameFx = nameFx;
  if (Array.isArray(r.badges)) {
    const badges: string[] = [];
    for (const b of r.badges) {
      const id = pick(b, 'badge');
      if (id && !badges.includes(id)) badges.push(id);
      if (badges.length === LOOK_MAX_BADGES) break;
    }
    if (badges.length) out.badges = badges;
  }
  return JSON.stringify(out).length > LOOK_MAX_BYTES ? {} : out;
}

export const isLookEmpty = (l: Look | undefined): boolean => !l || (!l.frame && !l.avatar && !l.nameFx && !l.badges?.length);
