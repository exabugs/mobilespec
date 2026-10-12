// src/rules/i18n.ts
//
// i18n の検証。
// - ja は生成物（仕様の name / label から導く）。仕様と食い違っていたら **1 件の error**（update を促す）
// - ja 以外の翻訳の欠落・未翻訳は info（実装不能ではない）
import fs from 'node:fs';
import path from 'node:path';

import { expectedJa } from '../core/derive.js';
import { type Diagnostic } from '../core/diagnostic.js';
import { type Project, asArray, isObj } from '../core/model.js';

export const I18N_DIR = 'i18n';

export function readLocale(specsDir: string, locale: string): Record<string, string> | undefined {
  const file = path.join(specsDir, I18N_DIR, `${locale}.json`);
  if (!fs.existsSync(file)) return undefined;
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return {};
    const json: unknown = JSON.parse(raw);
    return isObj(json) ? (json as Record<string, string>) : {};
  } catch {
    return undefined;
  }
}

export function localesOf(project: Project): string[] {
  const l = asArray(project.app?.data.locales).filter((x): x is string => typeof x === 'string');
  return l.length > 0 ? l : ['ja'];
}

export function checkI18n(project: Project): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!project.app) return out;
  const expected = expectedJa(project);
  const locales = localesOf(project);

  // ja（生成物）
  const jaFile = `${I18N_DIR}/ja.json`;
  const ja = readLocale(project.specsDir, 'ja');
  if (expected.size > 0 || ja !== undefined) {
    if (ja === undefined) {
      out.push({
        code: 'I18N_JA_STALE',
        level: 'error',
        file: jaFile,
        message: `${jaFile} がありません。ja は仕様から生成します: mobilespec update`,
      });
    } else {
      const missing = [...expected.keys()].filter((k) => !(k in ja));
      const extra = Object.keys(ja).filter((k) => !expected.has(k));
      const different = [...expected.entries()]
        .filter(([k, v]) => k in ja && ja[k] !== v)
        .map(([k]) => k);
      if (missing.length + extra.length + different.length > 0) {
        out.push({
          code: 'I18N_JA_STALE',
          level: 'error',
          file: jaFile,
          message: `${jaFile} が仕様と食い違っています（不足 ${missing.length} / 余分 ${extra.length} / 文言の違い ${different.length}）。ja は仕様から生成する生成物です。手で編集せず、mobilespec update を実行してください`,
          meta: {
            missing: missing.slice(0, 20),
            extra: extra.slice(0, 20),
            different: different.slice(0, 20),
          },
        });
      }
    }
  }

  // ja 以外（翻訳）
  for (const locale of locales) {
    if (locale === 'ja') continue;
    const file = `${I18N_DIR}/${locale}.json`;
    const dict = readLocale(project.specsDir, locale);
    if (dict === undefined) {
      if (expected.size > 0) {
        out.push({
          code: 'I18N_UNTRANSLATED',
          level: 'info',
          file,
          message: `ロケール "${locale}" の翻訳ファイルがありません（${expected.size} 件が未翻訳）`,
          meta: { locale, count: expected.size, keys: [...expected.keys()] },
        });
      }
      continue;
    }
    const untranslated = [...expected.keys()].filter((k) => !dict[k]);
    if (untranslated.length > 0) {
      out.push({
        code: 'I18N_UNTRANSLATED',
        level: 'info',
        file,
        message: `ロケール "${locale}" に未翻訳が ${untranslated.length} 件あります`,
        meta: { locale, count: untranslated.length, keys: untranslated },
      });
    }
  }
  return out;
}
