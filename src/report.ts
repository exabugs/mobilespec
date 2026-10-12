// src/report.ts
//
// 診断の表示。件数が多い i18n の診断は locale ごとに集計し、本質的なエラーが埋もれないようにする。
// すべてを見たいときは verbose（CLI の --verbose）。
import type { Diagnostic } from './types/diagnostic.js';

/** 集計時に locale ごとに表示するキーの数 */
const SAMPLE_KEYS_PER_LOCALE = 5;

export type Report = {
  /** error の行（stderr に出す） */
  errors: string[];
  /** info の行（stdout に出す） */
  infos: string[];
  errorCount: number;
  infoCount: number;
  /** 最後に出す 1 行の要約 */
  summary: string;
};

type LocaleKey = { locale: string; key: string };

function groupByLocale(items: Diagnostic[]): Map<string, string[]> {
  const byLocale = new Map<string, string[]>();
  for (const d of items) {
    const m = d.meta as LocaleKey | undefined;
    const locale = typeof m?.locale === 'string' ? m.locale : '?';
    const key = typeof m?.key === 'string' ? m.key : '?';
    byLocale.set(locale, [...(byLocale.get(locale) ?? []), key]);
  }
  return byLocale;
}

function aggregateI18n(items: Diagnostic[], label: string, mark: string): string[] {
  const lines: string[] = [];
  for (const [locale, keys] of groupByLocale(items)) {
    const sample = keys.slice(0, SAMPLE_KEYS_PER_LOCALE).join(', ');
    const rest = keys.length - SAMPLE_KEYS_PER_LOCALE;
    lines.push(
      `${mark} ${label}: locale="${locale}" ${keys.length} 件（例: ${sample}${
        rest > 0 ? ` ... +${rest}` : ''
      }）。一覧は --verbose`
    );
  }
  return lines;
}

export function buildReport(
  diagnostics: Diagnostic[],
  options: { verbose?: boolean } = {}
): Report {
  const errors = diagnostics.filter((d) => d.level === 'error');
  const infos = diagnostics.filter((d) => d.level === 'info');

  // 同じ内容の診断は 1 件にまとめる
  const dedupe = (list: Diagnostic[]): Diagnostic[] => {
    const seen = new Set<string>();
    return list.filter((d) => {
      if (seen.has(d.message)) return false;
      seen.add(d.message);
      return true;
    });
  };

  const errorLines: string[] = [];
  const infoLines: string[] = [];

  if (options.verbose) {
    for (const d of dedupe(errors)) errorLines.push(`❌ ${d.message}`);
    for (const d of dedupe(infos)) infoLines.push(`ℹ️ ${d.message}`);
  } else {
    const missing = errors.filter((d) => d.code === 'I18N_MISSING_KEY');
    for (const d of dedupe(errors.filter((e) => e.code !== 'I18N_MISSING_KEY'))) {
      errorLines.push(`❌ ${d.message}`);
    }
    errorLines.push(...aggregateI18n(missing, 'i18n 不整合（キーが存在しません）', '❌'));

    const untranslated = infos.filter((d) => d.code === 'I18N_UNTRANSLATED');
    for (const d of dedupe(infos.filter((i) => i.code !== 'I18N_UNTRANSLATED'))) {
      infoLines.push(`ℹ️ ${d.message}`);
    }
    infoLines.push(...aggregateI18n(untranslated, '未翻訳', 'ℹ️'));
  }

  const summary = `error ${errors.length} 件 / info ${infos.length} 件${
    options.verbose ? '' : '（i18n は集計表示。--verbose で全件）'
  }`;

  return {
    errors: errorLines,
    infos: infoLines,
    errorCount: errors.length,
    infoCount: infos.length,
    summary,
  };
}
