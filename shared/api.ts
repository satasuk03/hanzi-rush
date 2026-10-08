/**
 * Hanzi Rush HTTP API contract, shared by the backend (functions/ + server/, Cloudflare Pages Functions + D1)
 * and the client (src/, web + Capacitor). See docs/backend.md for the full spec.
 *
 * Rules for this file:
 *  - Pure TypeScript only. No DOM, Workers, or Node APIs (it is compiled into both runtimes).
 *  - It is the single source of truth: neither side redeclares these shapes.
 *  - Breaking changes need a new path prefix (/api/v2). Additive optional fields are fine.
 *  - SCORING must track src/games/quiz/QuizGame.ts. If game scoring changes, update SCORING
 *    and bump SCORING_VERSION, or the server will reject legitimate runs.
 */

import { sanitizeLook, type Look } from './cosmetics';
import { TITLE_DEFS } from './titles';

export { sanitizeLook };
export type { Look };

export const API_PREFIX = '/api/v1';

// ====================================================================== game identity

/** Games that have leaderboards (playable entries in src/games/registry.ts:30-31). */
export const RANKED_GAMES = ['quiz', 'cloze'] as const;
export type RankedGame = (typeof RANKED_GAMES)[number];

export const MODES = ['rush', 'zen'] as const;
export type Mode = (typeof MODES)[number];

/** HSK levels 1..6 (src/core/data.ts:19-26). */
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 6;

/** `${gameId}:${level}:${mode}`, the same format as bestKey() in src/games/registry.ts:38. */
export type BoardKey = `${RankedGame}:${number}:${Mode}`;

export const boardKey = (game: RankedGame, level: number, mode: Mode): BoardKey => `${game}:${level}:${mode}`;

export interface ParsedBoard {
  game: RankedGame;
  level: number;
  mode: Mode;
}

export function parseBoardKey(s: string): ParsedBoard | null {
  const m = /^([a-z]+):([1-9]):([a-z]+)$/.exec(s);
  if (!m) return null;
  const game = m[1] as RankedGame;
  const level = Number(m[2]);
  const mode = m[3] as Mode;
  if (!RANKED_GAMES.includes(game) || !MODES.includes(mode) || level < MIN_LEVEL || level > MAX_LEVEL) return null;
  return { game, level, mode };
}

// ====================================================================== save document
// Mirrors src/core/store.ts. store.ts should import these types from here and re-export them.

export type Lang = 'th' | 'en';

export interface Settings {
  lang: Lang;
  sound: boolean;
  pinyin: boolean;
  voice: boolean;
}

/** Per-word learning stats: [seen, correct]. */
export type WordStats = Record<string, [number, number]>;

/** `${level}:${hanzi}` → [copies, rarity index, first-pulled epoch seconds]. */
export type Cards = Record<string, [number, number, number]>;

export interface Stats {
  games: number;
  questions: number;
  correct: number;
  bestCombo: number;
  perfect: number;
  pulls: number;
  coinsEarned: number;
  coinsSpent: number;
  maxCoins: number;
  /** pulls per rarity index */
  byRarity: number[];
}

export interface Profile {
  name: string;
  /** equipped title id */
  title: string;
  /** titles the player has already been told about */
  seen: string[];
  /** equipped cosmetics (shared/cosmetics.ts); merged per slot, absent = default */
  look?: Look;
}

export interface Daily {
  /** local calendar day of the last claim, `YYYY-MM-DD` ('' = never) */
  last: string;
  streak: number;
  best: number;
  total: number;
}

export interface Progress {
  /** best score per `${gameId}:${level}:${mode}` (local best; NOT used for leaderboards) */
  best: Record<string, number>;
  words: WordStats;
  coins: number;
  xp: number;
  cards: Cards;
  /** pulls since the last LEGENDARY+ (hard pity) */
  pity: number;
  stats: Stats;
  profile: Profile;
  daily: Daily;
}

export const SAVE_FORMAT = 1;

/** What is uploaded and stored in `saves.data`. */
export interface SaveDoc {
  v: typeof SAVE_FORMAT;
  settings: Settings;
  progress: Progress;
}

// ====================================================================== auth

/** Every authenticated request sends `Authorization: Bearer <token>`. */
export const AUTH_HEADER = 'Authorization';
export const authValue = (token: string) => `Bearer ${token}`;

export type Platform = 'web' | 'ios' | 'android';

export interface DeviceInfo {
  platform: Platform;
  /** package.json version of the client build */
  appVersion: string;
}

/** POST /players: create an anonymous guest. No auth. */
export interface CreatePlayerRequest {
  device: DeviceInfo;
}

/** Returned by POST /players and POST /recover. The client persists playerId + token + tag. */
export interface AuthResponse {
  playerId: string;
  /** opaque secret, `hr1.<43 base64url chars>`. Only ever shown once. */
  token: string;
  /** 4-char public suffix used for unnamed players ("Player#7KQ2") */
  tag: string;
  createdAt: number;
  /** current cloud save, if any (so the client knows whether to pull) */
  save: SaveMeta | null;
  /** epoch ms the current transfer code was generated; null = none. Lets a client detect a stale cached code. */
  recoveryCreatedAt: number | null;
}

export type CreatePlayerResponse = AuthResponse;

export interface SaveMeta {
  revision: number;
  /** server epoch ms of the last accepted PUT */
  updatedAt: number;
}

/** GET /me */
export interface MeResponse {
  playerId: string;
  tag: string;
  name: string;
  title: string;
  createdAt: number;
  save: SaveMeta | null;
  hasRecoveryCode: boolean;
  /** epoch ms the current transfer code was generated; null = none */
  recoveryCreatedAt: number | null;
  /** "Show my card" (players.card_public); absent on servers that predate cards */
  cardPublic?: boolean;
  /** linked sign-in providers (POST /auth/:provider) */
  identities: { provider: IdentityProvider; linkedAt: number }[];
}

/** 'email' is reserved (identities.provider); only SIGNIN_PROVIDERS are accepted by POST /auth/:provider */
export type IdentityProvider = 'apple' | 'google' | 'play_games' | 'email';
export const SIGNIN_PROVIDERS = ['google', 'apple', 'play_games'] as const;
export type SignInProvider = (typeof SIGNIN_PROVIDERS)[number];

/**
 * POST /auth/:provider: sign in with, or link, a provider account. Auth is optional.
 *  - the provider account is already linked to some player → a new session for THAT player (`signedIn`). This is how
 *    a new device gets into an account; it may differ from the caller's account (the client then reconciles saves
 *    the same way as POST /recover).
 *  - not linked yet and the request is authenticated → it gets linked to the caller (`linked`)
 *  - not linked yet and no auth → 404 not_found
 * 409 identity_conflict (reason 'provider_linked'): the caller already has a different account of this provider.
 */
export interface SignInRequest {
  /** google / apple: the OpenID Connect ID token (JWT). play_games: a one-time server auth code. */
  credential: string;
  device: DeviceInfo;
}

export type SignInResponse =
  | { result: 'linked'; provider: SignInProvider; linkedAt: number }
  | { result: 'signedIn'; auth: AuthResponse };

/** DELETE /me/identities/:provider → 204 (also when nothing was linked). */

/** POST /me/recovery-code: (re)generates the transfer code. The previous code stops working. */
export interface RecoveryCodeRequest {
  /** also revoke every other session of this player (lost / shared device). Default false. */
  signOutOthers?: boolean;
}

export interface RecoveryCodeResponse {
  /** 12 chars from RECOVERY_ALPHABET, formatted `XXXX-XXXX-XXXX` */
  code: string;
  createdAt: number;
}

/** POST /recover: log this device into an existing account. No auth. */
export interface RecoverRequest {
  /** any case, dashes/spaces allowed; the server applies normalizeRecoveryCode() */
  code: string;
  device: DeviceInfo;
}

export type RecoverResponse = AuthResponse;

/**
 * PATCH /me/profile: change what others see. Every field is optional but at least one is required; each is sanitized
 * like its counterpart in POST /runs. A `look` replaces the whole look (slots left out go back to the default).
 */
export interface PatchProfileRequest {
  name?: string;
  title?: string;
  look?: Look;
  /** "Show my card": false makes GET /players/:pid/card answer 404 */
  cardPublic?: boolean;
}

/** the stored (sanitized) values after a PATCH /me/profile */
export interface PatchProfileResponse {
  name: string;
  title: string;
  look: Look;
  cardPublic?: boolean;
}

/** DELETE /me → 204. Deletes the player, sessions, save, runs and scores (App Store 5.1.1(v)). */

// ====================================================================== cloud save

/** GET /save → 200 SaveResponse, or 404 `not_found` if this player never uploaded. */
export interface SaveResponse extends SaveMeta {
  data: SaveDoc;
  /** ids of the last 16 accepted PUTs, oldest first */
  pushIds?: string[];
}

export const PUSH_IDS_KEPT = 16;

/** PUT /save: compare-and-swap on revision. */
export interface PutSaveRequest {
  /** revision the client's merge base came from; 0 when the server has no save yet */
  baseRevision: number;
  data: SaveDoc;
  /** client clock epoch ms (informational only, never trusted for ordering) */
  clientUpdatedAt: number;
  /**
   * Client-generated id of this attempt (ID_RE). The server remembers the last PUSH_IDS_KEPT accepted ids so a
   * client that lost the 200 reply can tell, from SaveResponse.pushIds, that its push did land (no double-merge
   * of additive fields).
   */
  pushId?: string;
}

/** 200 */
export type PutSaveResponse = SaveMeta;

/** 409 body: the error plus the current server copy, so the client can merge without another GET. */
export interface SaveConflictBody extends ApiErrorBody {
  current: SaveResponse;
}

// ====================================================================== runs / leaderboard

/** POST /runs/start: ask for a ticket when a run begins (fire-and-forget; runs work without one). */
export interface StartRunRequest {
  board: BoardKey;
}

export interface StartRunResponse {
  ticket: string;
  serverTime: number;
  expiresAt: number;
}

/** POST /runs: submit a finished run. */
export interface SubmitRunRequest {
  /** client-generated UUID, the idempotency key for retries from the offline queue */
  clientRunId: string;
  /** null when the run started offline (an unverified submission) */
  ticket: string | null;
  board: BoardKey;
  score: number;
  correct: number;
  asked: number;
  maxCombo: number;
  /** wall clock from QuizGame.start() (incl. countdown) to finish() */
  durationMs: number;
  /** client epoch ms at finish (informational) */
  playedAt: number;
  /** must be in the server's SUPPORTED_SCORING list */
  scoring: number;
  /** hearts bought back with POST /runs/continue (rush, ticketed runs only); absent = 0 */
  continues?: number;
  /** current display identity, applied to players.name/title (sanitized server side) */
  profile?: { name: string; title: string };
}

export interface RankInfo {
  /** 1-based; null if the player has no entry (e.g. hidden) */
  rank: number | null;
  /** player's best on that board for that period (may be higher than this run) */
  best: number;
  /** number of ranked players on the board for the period */
  total: number;
  /** true if this run raised the player's best for the period */
  improved: boolean;
}

export interface SubmitRunResponse {
  accepted: true;
  verified: boolean;
  ranks: Record<Period, RankInfo>;
}

export const PERIODS = ['all', 'week', 'day'] as const;
export type Period = (typeof PERIODS)[number];

/** GET /boards/:board?period=all|week|day&limit=50 (auth optional; when present, `me` is filled) */
export interface BoardQuery {
  period?: Period;
  /** default LIMITS.boardDefault, max LIMITS.boardMax */
  limit?: number;
}

export interface BoardEntry {
  rank: number;
  /** sanitized display name; '' means "unnamed" → client renders `${t('playerName')}#${tag}` */
  name: string;
  tag: string;
  /** title id; client localizes with titleById() and falls back to 'novice' if unknown */
  title: string;
  score: number;
  achievedAt: number;
  isMe: boolean;
  /** false = the run had no (or a late) server ticket; clients render a small mark */
  verified: boolean;
  /** equipped cosmetics; absent = the default look */
  look?: Look;
  /** public player id (`players.pub`): opens the player card. Absent on servers that predate cards */
  pid?: string;
}

export interface BoardResponse {
  board: BoardKey;
  period: Period;
  /** 'all' | 'd2026-10-06' | 'w2026-10-05' (see periodKeys) */
  periodKey: string;
  /** epoch ms when this period ends; null for 'all' */
  resetsAt: number | null;
  total: number;
  entries: BoardEntry[];
  /** the caller's entry, also when outside the top N; null if unauthenticated or no score */
  me: BoardEntry | null;
  serverTime: number;
}

/**
 * GET /boards/effort?period=all|week|day&limit=50: who has practiced the most. Ranked by correct answers summed over
 * VERIFIED (ticketed) runs of every game, level and mode. Completed runs only (quitting never submits).
 */
export interface EffortEntry {
  rank: number;
  name: string;
  tag: string;
  title: string;
  correct: number;
  runs: number;
  durationMs: number;
  isMe: boolean;
  look?: Look;
  pid?: string;
}

export interface EffortResponse {
  period: Period;
  periodKey: string;
  resetsAt: number | null;
  total: number;
  entries: EffortEntry[];
  me: EffortEntry | null;
  serverTime: number;
}

// ====================================================================== continues (an extra heart in rush)

/**
 * When a rush run loses its last heart it may continue with one heart, at most CONTINUE.max times per run.
 * Continue 1 costs a rewarded ad (native apps) or `jade[0]`; continue n ≥ 2 costs `jade[n - 1]`. Needs a ticket:
 * the server counts the continues on the run and POST /runs checks the submitted count against it.
 */
export const CONTINUE = {
  max: 3,
  jade: [10, 10, 20] as readonly number[],
  /** only this continue can be paid with an ad */
  adSlot: 1,
  /** per player per Bangkok day: continues paid with an ad */
  adsPerDay: 20,
} as const;

export const continueCost = (n: number): number => CONTINUE.jade[n - 1] ?? Infinity;

export type ContinueVia = 'ad' | 'jade';

/**
 * POST /runs/continue. Replaying the same (ticket, n) returns the first answer and charges nothing.
 * 402 insufficient_jade. 409 ad_unverified: AdMob has not confirmed the ad yet (retry for a few seconds).
 * 409 continue_refused, reason: closed (the run is submitted or expired), sequence (n is not the next continue),
 * max, ad_slot (an ad pays continue 1 only), ad_cap (CONTINUE.adsPerDay reached).
 */
export interface ContinueRequest {
  ticket: string;
  /** 1-based number of this continue in the run */
  n: number;
  via: ContinueVia;
}

export interface ContinueResponse {
  n: number;
  via: ContinueVia;
  /** Jade charged (0 for an ad) */
  cost: number;
  /** balance after the charge */
  jade: number;
  replay: boolean;
}

// ====================================================================== player card (docs/cosmetics-shop.md §12)

/** Lifetime numbers shown on a player card, rebuilt by the server from the validated save on every PUT /save. */
export interface PlayerCardStats {
  level: number;
  /** distinct words collected */
  words: number;
  games: number;
  correct: number;
  questions: number;
  bestCombo: number;
  /** best daily-login streak */
  bestStreak: number;
  /** titles the player has been told about (`profile.seen`) that this build knows */
  titles: number;
}

/**
 * GET /players/:pid/card (auth optional, `Cache-Control: public, max-age=30`). 404 for an unknown pid, a player who
 * is hidden from the boards, or one who turned "Show my card" off. `card` is null until the player's first save.
 */
export interface PlayerCardResponse {
  pid: string;
  name: string;
  tag: string;
  title: string;
  look?: Look;
  card: PlayerCardStats | null;
}

// ====================================================================== Jade wallet (docs/cosmetics-shop.md §11)

/** Daily Jade for streak slot 1..7 (the streak keeps counting past 7, the table loops). */
export const JADE_DAILY = [10, 10, 15, 15, 20, 20, 50] as const;
export const JADE_STARTER = 100;
/** The "day" of the Jade daily claim is the Asia/Bangkok calendar day (UTC+7, no DST). */
export { bangkokDay, dayNumber } from './day';
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface WalletDaily {
  /** today's Bangkok day */
  day: string;
  claimable: boolean;
  /** streak held right now (0 once lapsed) */
  streak: number;
  /** streak after claiming today */
  next: number;
  /** 0..6 index into JADE_DAILY that claiming today pays */
  slot: number;
}

/** GET /wallet */
export interface WalletResponse {
  jade: number;
  starterClaimed: boolean;
  daily: WalletDaily;
  /** item id → copies */
  inventory: Record<string, number>;
  /** box id → pulls since the last LEGENDARY+ */
  pity: Record<string, number>;
  /** the featured set of the Set Box now and when it rotates (epoch ms), see featuredSet in shared/cosmetics.ts */
  featured?: { set: string; endsAt: number };
  /** title ids already paid their Jade reward (ledger reason 'title', 'retro' excluded); absent from an old server */
  titlesPaid?: string[];
  serverTime: number;
}

/** Result of every ledger write. `replay` = this ref was already applied; nothing changed, `granted` is the original delta. */
export interface JadeGrantResponse {
  granted: number;
  replay: boolean;
  jade: number;
}

/** POST /jade/starter: no body. Once per account. */
export type JadeStarterResponse = JadeGrantResponse;

/** POST /jade/daily */
export interface JadeDailyRequest {
  /**
   * Bangkok day the player tapped CLAIM (client clock), for a claim that was queued offline. Accepted only for
   * today or yesterday (server clock) and never earlier than the last claim; default = today.
   */
  day?: string;
}

export interface JadeDailyResponse extends JadeGrantResponse {
  day: string;
  streak: number;
  slot: number;
}

// ====================================================================== shop (docs/cosmetics-shop.md §5.2, §11.6b)

/** POST /shop/pull. The server rolls; the client only says which box and how many. */
export interface ShopPullRequest {
  /** BoxDef id in shared/cosmetics.ts */
  box: string;
  /** 1 or BOX_MULTI (10) */
  qty: number;
  /** client idempotency key (uuid). A retry with the same ref returns the original result and charges nothing. */
  ref: string;
  /** featured set id the client saw (Set Box only). A stale one is refused with reason `rotated`. */
  set?: string;
}

export interface ShopDrop {
  itemId: string;
  rarity: number;
  /** first copy of this item for the player */
  isNew: boolean;
  /** copies owned after this drop */
  copies: number;
  /** Jade refunded for this drop (duplicates only, DUPLICATE_REFUND by item rarity) */
  refund: number;
}

export interface ShopPullResponse {
  box: string;
  qty: number;
  /** in roll order; the ×10 guarantee, if it fired, is the last one */
  drops: ShopDrop[];
  /** Jade charged (boxPrice) */
  cost: number;
  /** sum of the drops' refunds */
  refund: number;
  /** balance after the pull and the refunds */
  jade: number;
  /** box id → pulls since the last LEGENDARY+, after this pull */
  pity: Record<string, number>;
  /** true when `ref` had already been applied: this is the stored original result, nothing was charged now */
  replay: boolean;
  /** 'set'-source bonus items granted by this pull (completed sets); always [] on a replay, they show on the next wallet refresh */
  bonuses?: string[];
  /** the featured set this pull used (Set Box only) */
  set?: string;
}

// ---------------------------------------------------------------------- daily deals (phase D2)

/** One of today's offers. The server derives them from the player id and the Bangkok day. */
export interface ShopDeal {
  slot: number;
  itemId: string;
  rarity: number;
  price: number;
  /** this slot was bought today */
  bought: boolean;
  /** the item is in the inventory now (copies > 0) */
  owned: boolean;
}

/** GET /shop/deals */
export interface ShopDealsResponse {
  /** Bangkok day 'YYYY-MM-DD' of the offers */
  day: string;
  /** next Bangkok midnight, epoch ms */
  endsAt: number;
  deals: ShopDeal[];
  serverTime: number;
}

/** POST /shop/deals. 400 reasons: rotated (day is not today), no_deal, bought, owned. 402 insufficient_jade. */
export interface ShopDealBuyRequest {
  day: string;
  slot: number;
  /** client idempotency key, same shape as ShopPullRequest.ref */
  ref: string;
}

export interface ShopDealBuyResponse {
  day: string;
  slot: number;
  itemId: string;
  price: number;
  /** balance after the purchase */
  jade: number;
  /** copies of itemId after the purchase */
  copies: number;
  /** 'set'-source bonus items granted by this purchase; always [] on a replay */
  bonuses: string[];
  /** true when `ref` had already been applied: stored original result, nothing charged now */
  replay: boolean;
}

// ---------------------------------------------------------------------- title Jade rewards (phase D2)

/** POST /titles/claim (no body). 429 rate_limited within 10 s of the last claim. */
export interface TitleClaimResponse {
  /** titles settled by this call; a retroactive settle lists each with jade 0 and pays `retro` instead */
  paid: { id: string; jade: number }[];
  /** Jade paid as the one-off retroactive lump on the first claim (0 when none) */
  retro: number;
  /** balance after the claim */
  jade: number;
}

// ====================================================================== errors

export type ErrorCode =
  | 'bad_request' // 400 malformed JSON / failed schema validation
  | 'unsupported_version' // 400 unknown SAVE_FORMAT or scoring version
  | 'unauthorized' // 401 missing/unknown/revoked token, or bad recovery code
  | 'banned' // 403 the account is disabled (players.status = 2); clients must not create a new guest
  | 'not_found' // 404 no save yet, unknown route
  | 'method_not_allowed' // 405
  | 'save_conflict' // 409 baseRevision != current revision (body: SaveConflictBody)
  | 'payload_too_large' // 413
  | 'implausible' // 422 run failed checkRun() (reason in error.reason)
  | 'ticket_invalid' // 422 ticket unknown / other player / board mismatch / expired / reused by another run
  | 'insufficient_jade' // 402 POST /shop/pull: the balance does not cover the box
  | 'ad_unverified' // 409 POST /runs/continue: no verified ad reward for this run (yet)
  | 'continue_refused' // 409 POST /runs/continue: reason in error.reason
  | 'identity_conflict' // 409 POST /auth/:provider: reason in error.reason
  | 'rate_limited' // 429 (+ Retry-After header and error.retryAfter seconds)
  | 'server_error'; // 500

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** seconds, for rate_limited */
    retryAfter?: number;
    /** machine-readable detail, e.g. checkRun() reason */
    reason?: string;
  };
}

export const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unsupported_version: 400,
  unauthorized: 401,
  banned: 403,
  not_found: 404,
  method_not_allowed: 405,
  save_conflict: 409,
  payload_too_large: 413,
  implausible: 422,
  ticket_invalid: 422,
  insufficient_jade: 402,
  ad_unverified: 409,
  continue_refused: 409,
  identity_conflict: 409,
  rate_limited: 429,
  server_error: 500,
};

// ====================================================================== limits

export const LIMITS = {
  /** request body cap for everything except PUT /save */
  maxBodyBytes: 16 * 1024,
  /** PUT /save cap. Worst case today is about 350 KB (all 4,993 words seen + all cards owned). */
  maxSaveBytes: 512 * 1024,
  /** fetch keepalive bodies are capped at 64 KiB by browsers */
  keepaliveMaxBytes: 60 * 1024,
  nameMaxChars: 16,
  titlePattern: /^[a-z0-9_-]{1,24}$/,
  boardDefault: 50,
  boardMax: 100,
  /** per player: minimum seconds between accepted PUT /save */
  saveMinIntervalSec: 10,
  /** per player: minimum seconds between accepted PATCH /me/profile */
  profileMinIntervalSec: 3,
  /** per player: minimum seconds between accepted POST /shop/pull (a replayed ref is not limited) */
  pullMinIntervalSec: 1,
  /** per player: minimum seconds between POST /runs/start */
  runStartMinIntervalSec: 2,
  /** per player per board-day: tickets issued + unverified submissions */
  runsPerDay: 500,
  unverifiedRunsPerDay: 30,
  ticketTtlMs: 6 * 3600_000,
  /** per IP hash per hour */
  createPerIpPerHour: 30,
  recoverPerIpPerHour: 10,
  /** POST /auth/:provider, every attempt counts (each one costs the server a provider round trip) */
  signInPerIpPerHour: 30,
  /** client offline run queue */
  queueMax: 20,
  queueMaxAgeMs: 7 * 86400_000,
  /** client request timeout */
  timeoutMs: 8000,
  /** GET/PUT /save: the doc can be ~350 KB */
  saveTimeoutMs: 30_000,
  /** client: a queued run is dropped after this many failed deliveries (server answered, e.g. 5xx/429) */
  queueMaxTries: 20,
  /** client: a 429 asking to wait longer than this (seconds) drops the queued run (daily unverified cap) */
  queueDropRetryAfterSec: 300,
} as const;

// ====================================================================== leaderboard periods

/**
 * Daily/weekly boards roll over at midnight Asia/Bangkok (UTC+7, no DST): the default and main
 * audience is Thai (store.ts defaults lang 'th'). Weeks start on Monday.
 */
export const BOARD_UTC_OFFSET_MIN = 420;
const DAY_MS = 86400_000;

export interface PeriodKeys {
  all: 'all';
  /** `d${YYYY-MM-DD}` */
  day: string;
  /** `w${YYYY-MM-DD of Monday}` */
  week: string;
  dayResetsAt: number;
  weekResetsAt: number;
}

export function periodKeys(nowMs: number): PeriodKeys {
  const off = BOARD_UTC_OFFSET_MIN * 60_000;
  const dayN = Math.floor((nowMs + off) / DAY_MS);
  // 1970-01-01 was a Thursday → Monday-based index 3
  const dow = (((dayN + 3) % 7) + 7) % 7;
  const weekN = dayN - dow;
  const iso = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
  return {
    all: 'all',
    day: `d${iso(dayN)}`,
    week: `w${iso(weekN)}`,
    dayResetsAt: (dayN + 1) * DAY_MS - off,
    weekResetsAt: (weekN + 7) * DAY_MS - off,
  };
}

// ====================================================================== display names

/**
 * Canonical name cleanup, run on the server (authoritative) and in the profile input (src/games/gacha/profile.ts:40).
 * NFKC folds full-width/compat homoglyphs. Strips control/format/private-use chars (zero-width, bidi overrides).
 * Collapses whitespace. Clamps combining-mark runs to 3 (Thai needs ≤2; stops "zalgo" text). Max 16 code points.
 */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let s = raw.normalize('NFKC');
  s = s.replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/gu, '');
  s = s.replace(/\s+/gu, ' ').trim();
  s = s.replace(/(\p{M}{3})\p{M}+/gu, '$1');
  return [...s].slice(0, LIMITS.nameMaxChars).join('').trim();
}

const TITLE_IDS = new Set(TITLE_DEFS.map((t) => t.id));

/** the id must be in the title catalog (shared/titles.ts), not just well-formed; anything else is 'novice' */
export const sanitizeTitle = (raw: unknown): string => (typeof raw === 'string' && LIMITS.titlePattern.test(raw) && TITLE_IDS.has(raw) ? raw : 'novice');

// ====================================================================== recovery / transfer codes

/** Crockford-like alphabet without 0/O/1/I. 12 chars × 5 bits = 60 bits of entropy. */
export const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const RECOVERY_LEN = 12;

/** Uppercases, drops spaces/dashes; returns null if the result is not a well-formed code. */
export function normalizeRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== RECOVERY_LEN) return null;
  for (const c of s) if (!RECOVERY_ALPHABET.includes(c)) return null;
  return s;
}

export const formatRecoveryCode = (code: string) => code.match(/.{1,4}/g)!.join('-');

// ====================================================================== scoring & plausibility

/** Bump when SCORING changes; the server accepts SUPPORTED_SCORING only. */
export const SCORING_VERSION = 1;
export const SUPPORTED_SCORING: readonly number[] = [1];

/** Constants copied from the game engine. Cite and keep in sync. */
export const SCORING = {
  /** QuizGame.ts:29 */
  zenTotal: 20,
  /** QuizGame.ts:92 */
  rushLives: 3,
  /** QuizGame.ts:416, base = 100 + (level-1)*20 */
  baseStart: 100,
  basePerLevel: 20,
  /** QuizGame.ts:418, + 100 * frac, frac = timeLeft/timeMax ≤ 1 in rush, 0 in zen (:415) */
  speedBonus: 100,
  /** QuizGame.ts:417, mult = 1 + min(combo, 40) * 0.05 */
  comboCap: 40,
  comboStep: 0.05,
  /** QuizGame.ts:418, FEVER ×2 */
  feverMult: 2,
  /** QuizGame.ts:418, rounded to the nearest 10 */
  roundTo: 10,
  /** QuizGame.ts:264-282, 3 × 560 ms + 420 ms */
  countdownMs: 2100,
  /** conservative floor of real seconds per question (see docs/backend.md §6) */
  minQuestionMs: { quiz: 1000, cloze: 600 } as Record<RankedGame, number>,
  /** durations are accepted down to 80% of the floor (frame timing, clock jitter) */
  durationSlack: 0.8,
  /** hard sanity cap on questions in one rush run */
  maxAsked: 2000,
  /** tighter cap for ticketless (unverified) submissions: nobody gets 300 right in a row by accident */
  maxAskedUnticketed: 300,
} as const;

export const baseFor = (level: number) => SCORING.baseStart + (level - 1) * SCORING.basePerLevel;

/**
 * Tight-enough upper bound: the i-th correct answer of a run has combo ≤ min(i, maxCombo),
 * and every answer is assumed to hit FEVER and (in rush) the full speed bonus.
 * Each term uses the game's exact formula and rounding (QuizGame.ts:415-418), so legit runs never exceed it.
 */
export function maxScore(level: number, rush: boolean, correct: number, maxCombo: number): number {
  const base = baseFor(level) + (rush ? SCORING.speedBonus : 0);
  let total = 0;
  for (let i = 1; i <= correct; i++) {
    const combo = Math.min(i, maxCombo, SCORING.comboCap);
    const mult = 1 + combo * SCORING.comboStep;
    total += Math.round((base * mult * SCORING.feverMult) / SCORING.roundTo) * SCORING.roundTo;
  }
  return total;
}

/** Every correct answer pays at least round(1.05·base) ≥ base (combo ≥ 1, no fever, no speed bonus). */
export const minScore = (level: number, correct: number) => correct * baseFor(level);

export const minDurationMs = (game: RankedGame, asked: number) => SCORING.countdownMs + asked * SCORING.minQuestionMs[game];

export interface RunFacts {
  board: string;
  score: number;
  correct: number;
  asked: number;
  maxCombo: number;
  durationMs: number;
  /** absent = 0 */
  continues?: number;
}

/**
 * Pure plausibility check. Returns null if OK, else a short reason code.
 * Run by the server on every submission (authoritative) and by the client before
 * submitting (in dev a failure means SCORING drifted from the game code).
 */
export function checkRun(r: RunFacts, ticketed = true): string | null {
  const b = parseBoardKey(r.board);
  if (!b) return 'board';
  const ints = [r.score, r.correct, r.asked, r.maxCombo, r.durationMs];
  if (!ints.every((n) => Number.isSafeInteger(n) && n >= 0)) return 'not_int';
  if (r.asked < 1 || r.asked > (ticketed ? SCORING.maxAsked : SCORING.maxAskedUnticketed)) return 'asked_range';
  if (r.correct > r.asked) return 'correct_gt_asked';
  if (r.maxCombo > r.correct) return 'combo_gt_correct';
  const wrong = r.asked - r.correct;
  const rush = b.mode === 'rush';
  const cont = r.continues ?? 0;
  if (!Number.isSafeInteger(cont) || cont < 0 || cont > CONTINUE.max) return 'continues_range';
  // continues are counted on the ticket; practice has no hearts to buy back
  if (cont > 0 && (!rush || !ticketed)) return 'continues_scope';
  // rush ends exactly when the last life is lost (QuizGame.ts:595, :682); quitting never submits (:194-198).
  // Each continue gives back one heart.
  if (rush && wrong !== SCORING.rushLives + cont) return 'rush_lives';
  // practice is exactly 20 questions (QuizGame.ts:319)
  if (!rush && r.asked !== SCORING.zenTotal) return 'zen_total';
  // correct answers fall into at most wrong+1 streaks
  if (r.correct > 0 && r.maxCombo < Math.ceil(r.correct / (wrong + 1))) return 'combo_too_low';
  if (r.score % SCORING.roundTo !== 0) return 'score_rounding';
  if (r.score < minScore(b.level, r.correct)) return 'score_too_low';
  if (r.score > maxScore(b.level, rush, r.correct, r.maxCombo)) return 'score_too_high';
  if (r.durationMs < minDurationMs(b.game, r.asked) * SCORING.durationSlack) return 'too_fast';
  return null;
}
