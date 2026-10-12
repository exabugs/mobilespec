// src/core/model.ts — 読み込んだプロジェクトのモデル
import type { Diagnostic } from './diagnostic.js';
import type { Layer } from './names.js';

export type Doc = Record<string, unknown>;

/** 読み込んだ 1 ファイル（file は specs ディレクトリからの相対パス） */
export type FileDoc = { file: string; data: Doc };

/** 1 画面ぶんのファイル。画面の ID はファイル名から導く（ファイルの中に id は書かない） */
export type ScreenFiles = {
  id: string;
  l2?: FileDoc;
  l3?: FileDoc;
  l4?: FileDoc;
};

export type Project = {
  specsDir: string;
  app?: FileDoc;
  /** 画面 ID の昇順 */
  screens: Map<string, ScreenFiles>;
  /** 読み込み時に見つかった診断（YAML の構文エラー、ID の重複など） */
  diagnostics: Diagnostic[];
};

export type { Layer };

export const isObj = (v: unknown): v is Doc =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const asObj = (v: unknown): Doc => (isObj(v) ? v : {});
