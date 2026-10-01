/**
 * Game catalogue. Adding a new game = add an entry here + a folder under src/games/<id>/
 * exporting a `create(ctx)` that returns a Screen. Locked entries render as "coming soon".
 */
import type { Key } from '../core/i18n';
import type { Screen } from '../core/app';
import type { Word } from '../core/data';

export type Mode = 'rush' | 'zen';

export interface GameContext {
  level: number;
  mode: Mode;
  words: Word[];
}

export interface GameDef {
  id: string;
  name: Key;
  desc?: Key;
  /** big glyph on the card */
  glyph: string;
  color: string;
  dark: string;
  /** lazy-loaded so each game is its own chunk */
  load?: () => Promise<{ create: (ctx: GameContext) => Screen }>;
}

export const GAMES: GameDef[] = [
  { id: 'quiz', name: 'quizName', desc: 'quizDesc', glyph: '义', color: '#ff4757', dark: '#c8203a', load: () => import('./quiz/QuizGame') },
  { id: 'cloze', name: 'clozeName', desc: 'clozeDesc', glyph: '填', color: '#12b886', dark: '#0b8a65', load: () => import('./cloze/ClozeGame') },
  { id: 'pinyin', name: 'pinyinName', glyph: 'ā', color: '#3da5ff', dark: '#1c6fd1' },
  { id: 'tone', name: 'toneName', glyph: 'ˇ', color: '#9b6bff', dark: '#6a3fd6' },
  { id: 'stroke', name: 'strokeName', glyph: '笔', color: '#1fd1c1', dark: '#0e9488' },
  { id: 'listen', name: 'listenName', glyph: '听', color: '#ff9a1f', dark: '#d9650a' },
];

export const bestKey = (game: string, level: number, mode: Mode) => `${game}:${level}:${mode}`;
