// src/core/names.ts
//
// 名前の規則。
// - 画面の ID・遷移の ID・イベントのキー・部品の ID: 小文字のスネークケース
// - 状態・条件・データのキー・facts: 英字で始まる英数字と _（キャメルケース可）

export const SCREEN_ID = /^[a-z][a-z0-9_]*$/;
export const ITEM_ID = /^[a-z][a-z0-9_]*$/;
export const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** 予約語: アプリ外・SDK 管理の遷移先 */
export const EXTERNAL_TARGET = 'external';

/** 画面ファイルの規則（レイヤーごとの拡張子） */
export const LAYER_DIRS = {
  L2: { dir: 'L2.screenflows', ext: '.flow.yaml' },
  L3: { dir: 'L3.ui', ext: '.ui.yaml' },
  L4: { dir: 'L4.state', ext: '.state.yaml' },
} as const;

export type Layer = keyof typeof LAYER_DIRS;

/** i18n のキー */
export const titleKey = (screenId: string): string => `app.screen.${screenId}.title`;
export const labelKey = (screenId: string, componentId: string): string =>
  `app.screen.${screenId}.component.${componentId}.label`;
