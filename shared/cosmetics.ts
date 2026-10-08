/**
 * Cosmetics: slots, the item catalog and the box definitions (docs/cosmetics-shop.md §2, §11.6b).
 *
 * Rules for this file: pure TypeScript only (it is compiled into both the client and the Workers runtime) and it must
 * not import shared/api.ts (api.ts imports this file for sanitizeLook). Item ids are unique across slots, so the later
 * inventory can be keyed by id alone, and match ITEM_ID_RE.
 */

import { bangkokDay, dayNumber } from './day';

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

/**
 * `gacha` drops from boxes; `grant` is server-verified (rank badges, Founder); `event` is limited or not yet released;
 * `set` is the bonus for completing a set: never in a pool, granted by the server (sanitizeLook keeps it, ownedLook gates it)
 */
export type ItemSource = 'gacha' | 'grant' | 'event' | 'set';

export interface Item {
  id: string;
  slot: Slot;
  rarity: RarityIdx;
  /** themed collection (SETS is the source of truth; filled below, not in the item rows) */
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

/*
 * Frames, name effects and badges: one block per slot, so each can be edited on its own (phase C launch set: 14
 * frames, 12 name effects, 20 badges, weighted toward COMMON/RARE; docs/cosmetics-shop.md §8). The art is CSS keyed
 * by id: src/cosmetics/frames.css, namefx.css, badges.css (previews in dev/preview-*.html, `npx vite`). Ids are
 * prefixed by slot (`frame_`, `fx_`, `badge_`). Never rename or remove a released id: players own it.
 */

const FRAMES: Item[] = [
  item('frame_bamboo', 'frame', 0, '竹节', 'Bamboo Ring', 'กรอบไผ่'),
  item('frame_redstring', 'frame', 0, '红绳', 'Red String', 'ด้ายแดง'),
  item('frame_jadering', 'frame', 0, '玉环', 'Jade Ring', 'แหวนหยก'),
  item('frame_ink', 'frame', 0, '墨圈', 'Ink Circle', 'วงหมึก'),
  item('frame_copper', 'frame', 0, '铜钱', 'Copper Coin', 'เหรียญทองแดง'),
  item('frame_koi', 'frame', 1, '鱼鳞', 'Fish Scales', 'เกล็ดปลา'),
  item('frame_plum', 'frame', 1, '梅花', 'Plum Blossom', 'ดอกเหมย'),
  item('frame_cloud', 'frame', 1, '祥云', 'Auspicious Cloud', 'เมฆมงคล'),
  item('frame_lantern', 'frame', 1, '灯穗', 'Lantern Tassel', 'พู่โคมไฟ'),
  item('frame_lotus', 'frame', 2, '莲瓣', 'Lotus Petals', 'กลีบบัว'),
  item('frame_goldleaf', 'frame', 2, '金叶', 'Gold Leaf', 'ใบไม้ทอง'),
  item('frame_dragon', 'frame', 2, '龙鳞', 'Dragon Scale', 'เกล็ดมังกร'),
  item('frame_phoenix', 'frame', 3, '凤焰', 'Phoenix Flame', 'เปลวหงส์'),
  item('frame_heaven', 'frame', 4, '天命', 'Mandate of Heaven', 'บัญชาสวรรค์'),
];

const NAME_FX: Item[] = [
  item('fx_zhuhong', 'nameFx', 0, '朱红', 'Vermilion', 'แดงชาด'),
  item('fx_daiqing', 'nameFx', 0, '黛青', 'Slate Blue', 'น้ำเงินคราม'),
  item('fx_hupo', 'nameFx', 0, '琥珀', 'Amber', 'สีอำพัน'),
  item('fx_songlv', 'nameFx', 0, '松绿', 'Pine', 'เขียวสน'),
  item('fx_wanxia', 'nameFx', 1, '晚霞', 'Sunset', 'อาทิตย์อัสดง'),
  item('fx_bibo', 'nameFx', 1, '碧波', 'Teal Wave', 'คลื่นเขียวคราม'),
  item('fx_zijin', 'nameFx', 1, '紫金', 'Violet Gold', 'ม่วงทอง'),
  item('fx_moyun', 'nameFx', 2, '墨韵', 'Ink Wash', 'หมึกจีน'),
  item('fx_chiyan', 'nameFx', 2, '赤焰', 'Crimson Flame', 'เปลวแดง'),
  item('fx_cuiyu', 'nameFx', 2, '翠玉', 'Emerald Glow', 'หยกมรกต'),
  item('fx_liujin', 'nameFx', 3, '流金', 'Gilded', 'ทองอร่าม'),
  item('fx_fenghuang', 'nameFx', 4, '凤凰', 'Phoenix Glow', 'ประกายหงส์'),
  // animated (phase D): src/cosmetics/namefx.css
  item('fx_yinguang', 'nameFx', 1, '银光', 'Silver Gleam', 'ประกายเงิน'),
  item('fx_yinghuo', 'nameFx', 1, '萤火', 'Firefly', 'แสงหิ่งห้อย'),
  item('fx_jiguang', 'nameFx', 2, '极光', 'Aurora', 'แสงออโรรา'),
  item('fx_leiting', 'nameFx', 2, '雷霆', 'Thunder', 'อัสนีบาต'),
  item('fx_xinghe', 'nameFx', 3, '星河', 'Milky Way', 'ทางช้างเผือก'),
  item('fx_tianguang', 'nameFx', 4, '天光', 'Heavenly Radiance', 'แสงสวรรค์'),
];

const BADGES: Item[] = [
  item('badge_fortune', 'badge', 0, '福运', 'Fortune', 'โชคลาภ'),
  item('badge_joy', 'badge', 0, '喜气', 'Joy', 'ความยินดี'),
  item('badge_study', 'badge', 0, '学者', 'Scholar', 'บัณฑิต'),
  item('badge_letters', 'badge', 0, '文人', 'Letters', 'อักษร'),
  item('badge_mountain', 'badge', 0, '山岳', 'Mountain', 'ภูเขา'),
  item('badge_moon', 'badge', 0, '月光', 'Moonlight', 'แสงจันทร์'),
  item('badge_fire', 'badge', 0, '火焰', 'Flame', 'เปลวไฟ'),
  item('badge_wood', 'badge', 0, '木叶', 'Leaf', 'ใบไม้'),
  item('badge_courage', 'badge', 1, '勇士', 'Courage', 'กล้าหาญ'),
  item('badge_wisdom', 'badge', 1, '智者', 'Wisdom', 'ปัญญา'),
  item('badge_spring', 'badge', 1, '春风', 'Spring', 'ฤดูใบไม้ผลิ'),
  item('badge_wind', 'badge', 1, '风行', 'Wind', 'สายลม'),
  item('badge_snow', 'badge', 1, '雪花', 'Snow', 'หิมะ'),
  item('badge_star', 'badge', 1, '星辰', 'Starlight', 'แสงดาว'),
  item('badge_dragon', 'badge', 2, '龙威', 'Dragon Might', 'อานุภาพมังกร'),
  item('badge_pearl', 'badge', 2, '明珠', 'Pearl', 'ไข่มุก'),
  item('badge_jade', 'badge', 2, '玉佩', 'Jade Pendant', 'จี้หยก'),
  item('badge_gold', 'badge', 3, '金榜', 'Honor Roll', 'ทำเนียบทอง'),
  item('badge_sage', 'badge', 3, '圣贤', 'Sage', 'ปราชญ์'),
  item('badge_divine', 'badge', 4, '神明', 'Divine', 'เทพเจ้า'),
];

/** set-completion bonus seals, one per set (SETS[].bonus); rarity = the highest in the set. The board shows zh[0] as the glyph. */
const SET_BADGES: Item[] = [
  item('badge_set_bamboo', 'badge', 0, '竹韵', 'Bamboo Seal', 'ตราป่าไผ่', 'set'),
  item('badge_set_scholar', 'badge', 2, '砚池', 'Inkstone Seal', 'ตราแท่นฝนหมึก', 'set'),
  item('badge_set_koi', 'badge', 2, '锦鳞', 'Koi Seal', 'ตราปลาคาร์ปมงคล', 'set'),
  item('badge_set_lantern', 'badge', 2, '元夕', 'Lantern Night Seal', 'ตราคืนโคมไฟ', 'set'),
  item('badge_set_jade', 'badge', 3, '玉玺', 'Imperial Jade Seal', 'ตราหยกจักรพรรดิ', 'set'),
  item('badge_set_fortune', 'badge', 3, '聚宝', 'Treasure Seal', 'ตราขุมทรัพย์', 'set'),
  item('badge_set_phoenix', 'badge', 4, '凤鸣', 'Phoenix Song Seal', 'ตราหงส์ขาน', 'set'),
  item('badge_set_dragon', 'badge', 4, '腾龙', 'Soaring Dragon Seal', 'ตรามังกรทะยาน', 'set'),
];

export const ITEMS: readonly Item[] = [...AVATARS.map(([id, zh, en, th, r]) => item(AVATAR_PREFIX + id, 'avatar', r, zh, en, th)), ...FRAMES, ...NAME_FX, ...BADGES, ...SET_BADGES];

/** the items a box can drop (any slot), by rarity index */
export const gachaPool = (rarity: RarityIdx): Item[] => ITEMS.filter((i) => i.source === 'gacha' && i.rarity === rarity);

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

export const itemById = (id: string): Item | undefined => BY_ID.get(id);

/** the item if `id` exists and belongs to `slot` */
export const itemInSlot = (id: unknown, slot: Slot): Item | undefined => {
  const it = typeof id === 'string' ? BY_ID.get(id) : undefined;
  return it && it.slot === slot ? it : undefined;
};

// ====================================================================== sets

export interface SetDef {
  /** ^[a-z0-9_-]{1,16}$ */
  id: string;
  zh: string;
  en: string;
  th: string;
  /** gacha item ids, one per slot; completing = owning all of them */
  items: readonly string[];
  /** the 'set'-source badge granted on completion */
  bonus: string;
}

/** Built from existing items, so current players already have progress. An item belongs to at most one set. */
export const SETS: readonly SetDef[] = [
  { id: 'bamboo', zh: '竹林', en: 'Bamboo Grove', th: 'ป่าไผ่', items: ['avatar_bamboo', 'frame_bamboo', 'fx_songlv', 'badge_wood'], bonus: 'badge_set_bamboo' },
  { id: 'scholar', zh: '文房', en: "Scholar's Study", th: 'ห้องบัณฑิต', items: ['avatar_brush', 'frame_ink', 'fx_moyun', 'badge_study'], bonus: 'badge_set_scholar' },
  { id: 'koi', zh: '锦鲤', en: 'Koi Pond', th: 'สระปลาคาร์ป', items: ['avatar_koi', 'frame_koi', 'fx_bibo', 'badge_pearl'], bonus: 'badge_set_koi' },
  { id: 'lantern', zh: '元宵', en: 'Lantern Festival', th: 'เทศกาลโคมไฟ', items: ['avatar_lantern', 'frame_lantern', 'fx_zhuhong', 'badge_joy'], bonus: 'badge_set_lantern' },
  { id: 'jade', zh: '美玉', en: 'Fine Jade', th: 'หยกงาม', items: ['avatar_jaderabbit', 'frame_jadering', 'fx_cuiyu', 'badge_jade'], bonus: 'badge_set_jade' },
  { id: 'fortune', zh: '招财', en: 'Fortune', th: 'โชคลาภ', items: ['avatar_wealth', 'frame_copper', 'fx_liujin', 'badge_fortune'], bonus: 'badge_set_fortune' },
  { id: 'phoenix', zh: '凤凰', en: 'Phoenix', th: 'หงส์', items: ['avatar_phoenix', 'frame_phoenix', 'fx_fenghuang', 'badge_fire'], bonus: 'badge_set_phoenix' },
  { id: 'dragon', zh: '神龙', en: 'Dragon', th: 'มังกร', items: ['avatar_dragon', 'frame_dragon', 'fx_chiyan', 'badge_dragon'], bonus: 'badge_set_dragon' },
];

for (const s of SETS) for (const id of s.items) {
  const it = BY_ID.get(id);
  if (it) it.set = s.id;
}

export const setById = (id: string): SetDef | undefined => SETS.find((s) => s.id === id);

/** every set whose items are all owned */
export const completedSets = (owns: (id: string) => boolean): SetDef[] => SETS.filter((s) => s.items.every(owns));

/** bonus ids of completed sets whose bonus is not owned yet */
export const bonusesDue = (owns: (id: string) => boolean): string[] => completedSets(owns).filter((s) => !owns(s.bonus)).map((s) => s.bonus);

// ====================================================================== boxes

/** rates are percentages for COMMON..MYTHIC and add up to 100 */
export interface BoxDef {
  id: 'standard' | 'select' | 'supreme' | 'set';
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
  /** drops favour the featured set of the week (SET_RATE_UP) */
  featured?: boolean;
}

/** the rarity index the hard pity guarantees (LEGENDARY) */
export const PITY_RARITY: RarityIdx = 3;

export const BOXES: readonly BoxDef[] = [
  { id: 'standard', zh: '漆匣', en: 'Standard Box', th: 'กล่องธรรมดา', price: 100, rates: [55, 28, 12, 4, 1], pity: 30, minRarity: 0 },
  { id: 'select', zh: '银匣', en: 'Select Box', th: 'กล่องเงิน', price: 250, rates: [0, 60, 27, 10, 3], pity: 12, minRarity: 1 },
  { id: 'supreme', zh: '金匣', en: 'Supreme Box', th: 'กล่องทอง', price: 600, rates: [0, 0, 60, 30, 10], pity: 5, minRarity: 2 },
  // last, so existing indexes and keyboard order hold. Standard numbers; the set rate-up is economy-neutral.
  { id: 'set', zh: '套匣', en: 'Set Box', th: 'กล่องชุด', price: 100, rates: [55, 28, 12, 4, 1], pity: 30, minRarity: 0, featured: true },
];

/** share of drops taken from the featured set when the rolled rarity has a set item */
export const SET_RATE_UP = 0.5;
/** rotation order; week 0 starts SET_ROTATION_FROM (a Monday, Bangkok). Append-only: a change takes effect at deploy. */
export const SET_ROTATION: readonly string[] = ['jade', 'bamboo', 'koi', 'lantern', 'scholar', 'fortune', 'phoenix', 'dragon'];
export const SET_ROTATION_FROM = '2026-10-05';

/** the featured set at `ms` and when it ends (next Monday 00:00 Asia/Bangkok, epoch ms) */
export function featuredSet(ms: number): { set: SetDef; endsAt: number } {
  const week = Math.floor((dayNumber(bangkokDay(ms)) - dayNumber(SET_ROTATION_FROM)) / 7);
  const n = SET_ROTATION.length;
  const set = setById(SET_ROTATION[((week % n) + n) % n])!;
  return { set, endsAt: Date.parse(SET_ROTATION_FROM + 'T00:00:00Z') - 7 * 3600_000 + (week + 1) * 7 * 86_400_000 };
}

export const boxById = (id: string): BoxDef | undefined => BOXES.find((b) => b.id === id);

/** ×10 pays for 9 (the last pull is a guaranteed EPIC or better) */
export const BOX_MULTI = 10;
export const boxPrice = (b: BoxDef, qty: number): number => b.price * (qty >= BOX_MULTI ? qty - Math.floor(qty / BOX_MULTI) : qty);

/** Jade refunded for a duplicate, by item rarity (not by box price) */
export const DUPLICATE_REFUND: readonly number[] = [5, 10, 25, 50, 100];

/** Jade price of a direct-buy daily deal by item rarity (C..M). MYTHIC is never offered */
export const DEAL_PRICE: readonly number[] = [60, 150, 400, 1200, 0];
/** rarity weights (C..M, %) of each daily deal slot */
export const DEAL_SLOTS: readonly (readonly [number, number, number, number, number])[] = [
  [70, 30, 0, 0, 0],
  [0, 60, 40, 0, 0],
  [0, 0, 75, 25, 0],
];

// ====================================================================== sanitizing

/**
 * Canonical look cleanup, run on the server (authoritative) and by the renderer. Known slots only; every id must exist
 * in the catalog for its slot; badges are deduped and capped; anything invalid falls back to the default (dropped).
 * `grant` items are kept out until a grants table can vouch for them (phase E); `set` bonuses are kept (ownership is
 * enforced by ownedLook, as for every item).
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
