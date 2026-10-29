/**
 * Game catalogue. Adding a new game = add an entry here + a folder under src/games/<id>/
 * exporting a `create(ctx)` that returns a Screen. Locked entries render as "coming soon".
 */
import type { Key } from '../core/i18n';
import type { Screen } from '../core/app';
import type { Word } from '../core/data';
import { RANKED_LEVELS, type Mode } from '../../shared/api';
export type { Mode };

export interface GameContext {
  level: number;
  mode: Mode;
  words: Word[];
}

export interface GameDef {
  id: string;
  name: Key;
  desc?: Key;
  /** SVG badge on the card: a picture of what you do in the game (inherits --c via currentColor) */
  icon: string;
  color: string;
  dark: string;
  /** one fixed-length mode only: the levels screen hides the Rush/Practice switch */
  practiceOnly?: boolean;
  /** lazy-loaded so each game is its own chunk */
  /** highest playable level (the rest show as coming soon) */
  maxLevel?: number;
  load?: () => Promise<{ create: (ctx: GameContext) => Screen }>;
}

/** speech bubble ?, tile dropping into a blank, pinyin ā, tone contour, brush stroke, headphones */
const ICON = {
  quiz: `<svg viewBox="0 0 32 32"><path d="M6 4h20a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H15.5L9 27.5V22H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" fill="currentColor" stroke="#2a1a3a" stroke-width="2.4" stroke-linejoin="round"/><path d="M12.6 10.4a3.4 3.4 0 1 1 4.7 3.1c-.9.4-1.3 1-1.3 2" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/><circle cx="16" cy="18.6" r="1.6" fill="#fff"/></svg>`,
  cloze: `<svg viewBox="0 0 32 32"><rect x="1.5" y="19" width="8" height="8" rx="2" fill="#fff" stroke="#2a1a3a" stroke-width="2.2"/><rect x="12" y="19" width="8" height="8" rx="2" fill="none" stroke="#2a1a3a" stroke-width="2.2" stroke-dasharray="2.6 1.8"/><rect x="22.5" y="19" width="8" height="8" rx="2" fill="#fff" stroke="#2a1a3a" stroke-width="2.2"/><rect x="11" y="3" width="10" height="10" rx="2.4" fill="currentColor" stroke="#2a1a3a" stroke-width="2.4" transform="rotate(-10 16 8) translate(0 1.5)"/><path d="M7.5 6v5M24.5 6v5" stroke="#2a1a3a" stroke-width="2" stroke-linecap="round" opacity=".45"/></svg>`,
  pinyin: `<svg viewBox="0 0 32 32"><path d="M6 4h20a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H15.5L9 27.5V22H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" fill="currentColor" stroke="#2a1a3a" stroke-width="2.4" stroke-linejoin="round"/><path d="M11.5 8.2h8" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="14.6" cy="15.2" r="3.4" fill="none" stroke="#fff" stroke-width="2.6"/><path d="M18 11.6v7.4" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  tone: `<svg viewBox="0 0 32 32"><path d="M3 22l6-10 7 12 6-17 7 9" fill="none" stroke="#2a1a3a" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 22l6-10 7 12 6-17 7 9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  stroke: `<svg viewBox="0 0 32 32"><path d="M3.5 27c4-4 8-4.5 12.5-3" fill="none" stroke="#2a1a3a" stroke-width="6" stroke-linecap="round"/><path d="M3.5 27c4-4 8-4.5 12.5-3" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><g transform="rotate(38 17 24)"><rect x="14.5" y="2" width="5" height="12" rx="1.6" fill="#c98a4b" stroke="#2a1a3a" stroke-width="2.2"/><rect x="13.8" y="13.5" width="6.4" height="3.2" rx="1" fill="#ffc93c" stroke="#2a1a3a" stroke-width="2.2"/><path d="M13.8 16.6h6.4c0 3.6-1.4 6-3.2 8-1.8-2-3.2-4.4-3.2-8z" fill="#2a1a3a" stroke="#2a1a3a" stroke-width="1.6" stroke-linejoin="round"/></g></svg>`,
  detective: `<svg viewBox="0 0 32 32"><rect x="2.5" y="3.5" width="17" height="21" rx="3" fill="#fff" stroke="#2a1a3a" stroke-width="2.2" transform="rotate(-8 11 14)"/><path d="M6.5 10.5l8-1.1M7 15l5-.7" stroke="#2a1a3a" stroke-width="2" stroke-linecap="round" opacity=".45"/><path d="M23.6 23.6l5.4 5.4" stroke="#2a1a3a" stroke-width="5.6" stroke-linecap="round"/><path d="M23.6 23.6l5.4 5.4" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="18" cy="18" r="7.6" fill="#bfe6ff" fill-opacity=".85" stroke="#2a1a3a" stroke-width="2.6"/><path d="M14.6 15.6a4 4 0 0 1 3-2.4" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`,
  listen: `<svg viewBox="0 0 32 32"><path d="M6 19v-3a10 10 0 0 1 20 0v3" fill="none" stroke="#2a1a3a" stroke-width="3" stroke-linecap="round"/><rect x="3.5" y="16.5" width="7" height="11" rx="3" fill="currentColor" stroke="#2a1a3a" stroke-width="2.4"/><rect x="21.5" y="16.5" width="7" height="11" rx="3" fill="currentColor" stroke="#2a1a3a" stroke-width="2.4"/></svg>`,
};

export const GAMES: GameDef[] = [
  { id: 'quiz', name: 'quizName', desc: 'quizDesc', icon: ICON.quiz, color: '#ff4757', dark: '#c8203a', load: () => import('./quiz/QuizGame') },
  { id: 'cloze', name: 'clozeName', desc: 'clozeDesc', icon: ICON.cloze, color: '#12b886', dark: '#0b8a65', load: () => import('./cloze/ClozeGame') },
  { id: 'detective', name: 'detName', desc: 'detDesc', icon: ICON.detective, color: '#ffb020', dark: '#d97b06', practiceOnly: true, load: () => import('./detective/DetectiveGame') },
  { id: 'pinyin', name: 'pinyinName', icon: ICON.pinyin, color: '#3da5ff', dark: '#1c6fd1' },
  { id: 'tone', name: 'toneName', icon: ICON.tone, color: '#9b6bff', dark: '#6a3fd6' },
  { id: 'stroke', name: 'strokeName', desc: 'strokeDesc', icon: ICON.stroke, color: '#1fd1c1', dark: '#0e9488', maxLevel: RANKED_LEVELS.stroke, load: () => import('./stroke/StrokeGame') },
  { id: 'listen', name: 'listenName', icon: ICON.listen, color: '#ff9a1f', dark: '#d9650a' },
];

export const bestKey = (game: string, level: number, mode: Mode) => `${game}:${level}:${mode}`;
