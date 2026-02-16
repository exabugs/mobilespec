// src/validate/i18n.ts
import fs from 'node:fs';
import path from 'node:path';

import type { Diagnostic } from '../types/diagnostic.js';
import { i18nMissingKey, i18nUntranslated } from './diagnostics.js';
import type { YamlFile } from './io.js';
import type { Screen } from './types.js';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function screenPrefix(screenId: string, context?: string): string {
  return context ? `app.screen.${screenId}.ctx.${context}` : `app.screen.${screenId}`;
}

function collectExpectedI18nKeys(l2Screens: Map<string, Screen>, uiFiles: YamlFile[]): Set<string> {
  const keys = new Set<string>();

  // L2: screen title
  for (const s of l2Screens.values()) {
    const k = `${screenPrefix(s.id, s.context)}.title`;
    keys.add(k);
  }

  // L3: component label (node.name があるもの)
  for (const file of uiFiles) {
    const doc = file.data;
    if (!isObj(doc)) continue;
    const screen = doc.screen;
    if (!isObj(screen)) continue;

    const screenId = typeof screen.id === 'string' ? screen.id : '';
    if (!screenId) continue;

    const context = typeof screen.context === 'string' ? screen.context : undefined;

    const layout = screen.layout;
    if (!isObj(layout)) continue;

    // root(layout) は id 不要（方針）
    const stack: Array<{ node: Record<string, unknown> }> = [{ node: layout }];

    while (stack.length > 0) {
      const cur = stack.pop()!;
      const node = cur.node;

      // i18n 対象は「name を持つノード」だけ
      const name = node.name;
      if (typeof name === 'string' && name.length > 0) {
        const nodeId = typeof node.id === 'string' ? node.id : '';
        if (nodeId) {
          const k = `${screenPrefix(screenId, context)}.component.${nodeId}.label`;
          keys.add(k);
        }
      }

      // children
      if (Array.isArray(node.children)) {
        for (const c of node.children) if (isObj(c)) stack.push({ node: c });
      }

      // node.layout.children
      if (isObj(node.layout) && Array.isArray((node.layout as Record<string, unknown>).children)) {
        const lc = (node.layout as Record<string, unknown>).children as unknown[];
        for (const c of lc) if (isObj(c)) stack.push({ node: c });
      }
    }
  }

  return keys;
}

function listLocaleFiles(i18nDir: string): string[] {
  if (!fs.existsSync(i18nDir)) return [];
  return fs
    .readdirSync(i18nDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

function readJsonMap(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, string>;
}

export function validateI18n(
  specsDir: string,
  config: { i18n?: { locales?: string[] } },
  l2Screens: Map<string, Screen>,
  uiFiles: YamlFile[]
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const i18nDir = path.join(specsDir, 'i18n');

  const expectedKeys = collectExpectedI18nKeys(l2Screens, uiFiles);

  // locales は config.i18n.locales を優先。無ければ i18n/*.json から推定
  const locales =
    Array.isArray(config.i18n?.locales) && config.i18n!.locales.length > 0
      ? config.i18n!.locales
      : listLocaleFiles(i18nDir);

  if (locales.length === 0) {
    // i18n 未導入なら何もしない（構造が無い状態として許容）
    return diagnostics;
  }

  // 基準言語: ja（存在しないなら実装不能＝error。ただし他の検査は続ける）
  if (!locales.includes('ja')) {
    diagnostics.push({
      code: 'I18N_MISSING_KEY',
      level: 'error',
      message: `i18n不整合: locales に "ja" が含まれていません（基準言語が必要）`,
      meta: {
        locales,
        hint: 'Add "ja" to mobilespec.config.yml i18n.locales and create i18n/ja.json',
      },
    });
  }

  // 各 locale の辞書を読む（存在しないファイルは空辞書扱い→ key 欠落として error になる）
  const dictByLocale = new Map<string, Record<string, string>>();
  for (const loc of locales) {
    const p = path.join(i18nDir, `${loc}.json`);
    dictByLocale.set(loc, readJsonMap(p));
  }

  for (const loc of locales) {
    const dict = dictByLocale.get(loc) ?? {};
    for (const k of expectedKeys) {
      if (!(k in dict)) {
        diagnostics.push(i18nMissingKey(loc, k));
        continue;
      }
      // 未翻訳は状態(info)。ja は基準なので未翻訳判定しない
      if (loc !== 'ja' && dict[k] === '') {
        diagnostics.push(i18nUntranslated(loc, k));
      }
    }
  }

  return diagnostics;
}
