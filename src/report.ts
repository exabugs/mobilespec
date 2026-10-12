// src/report.ts
//
// 診断の表示。
// - テキスト: 人向け。info は集計して、本質的なエラーが埋もれないようにする（--verbose で全件）
// - JSON: AI 向け。file + pointer + found / expected / suggest で、自力で直せる（A4）
import type { Diagnostic } from './core/diagnostic.js';

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

/** info を集計せず全件出す件数の上限（これを超える種類は、先頭の数件 + 件数にする） */
const INFO_SAMPLE = 3;
const INFO_COLLAPSE_OVER = 5;

function where(d: Diagnostic): string {
  if (!d.file) return '';
  return d.pointer ? `${d.file}#${d.pointer}` : d.file;
}

function line(mark: string, d: Diagnostic): string {
  const w = where(d);
  const extra =
    d.expected && d.expected.length > 0 && d.expected.length <= 8
      ? `（候補: ${d.expected.join(', ')}）`
      : '';
  return `${mark} ${w ? `${w} — ` : ''}${d.message}${d.suggest ? '' : extra}`;
}

export function buildReport(
  diagnostics: Diagnostic[],
  options: { verbose?: boolean } = {}
): Report {
  const errors = diagnostics.filter((d) => d.level === 'error');
  const infos = diagnostics.filter((d) => d.level === 'info');
  const errorLines = errors.map((d) => line('❌', d));
  const infoLines: string[] = [];

  if (options.verbose) {
    for (const d of infos) infoLines.push(line('ℹ️', d));
  } else {
    // i18n の未翻訳は、ロケールごとの 1 行に集計する
    const untranslated = infos.filter((d) => d.code === 'I18N_UNTRANSLATED');
    const rest = infos.filter((d) => d.code !== 'I18N_UNTRANSLATED');

    // 同じ種類の info が多いときは、先頭の数件 + 件数にする
    const byCode = new Map<string, Diagnostic[]>();
    for (const d of rest) byCode.set(d.code, [...(byCode.get(d.code) ?? []), d]);
    for (const list of byCode.values()) {
      if (list.length <= INFO_COLLAPSE_OVER) {
        for (const d of list) infoLines.push(line('ℹ️', d));
      } else {
        for (const d of list.slice(0, INFO_SAMPLE)) infoLines.push(line('ℹ️', d));
        infoLines.push(
          `ℹ️ …ほか ${list.length - INFO_SAMPLE} 件（${list[0].code}）。全件は --verbose`
        );
      }
    }
    for (const d of untranslated) {
      const m = d.meta as { locale?: string; count?: number; keys?: string[] } | undefined;
      const sample = (m?.keys ?? []).slice(0, 3).join(', ');
      infoLines.push(
        `ℹ️ 未翻訳: locale="${m?.locale ?? '?'}" ${m?.count ?? '?'} 件（例: ${sample}）。全件は --verbose`
      );
    }
  }

  const summary = `error ${errors.length} 件 / info ${infos.length} 件${
    options.verbose ? '' : '（info は集計表示。--verbose で全件）'
  }`;
  return {
    errors: errorLines,
    infos: infoLines,
    errorCount: errors.length,
    infoCount: infos.length,
    summary,
  };
}

/** 機械可読な形（AI 向け）。キーは安定させる */
export function toJson(diagnostics: Diagnostic[]): string {
  const errors = diagnostics.filter((d) => d.level === 'error');
  const body = {
    ok: errors.length === 0,
    errors: errors.length,
    infos: diagnostics.length - errors.length,
    diagnostics: diagnostics.map((d) => ({
      code: d.code,
      level: d.level,
      ...(d.file !== undefined && { file: d.file }),
      ...(d.pointer !== undefined && { pointer: d.pointer }),
      message: d.message,
      ...(d.found !== undefined && { found: d.found }),
      ...(d.expected !== undefined && { expected: d.expected }),
      ...(d.suggest !== undefined && { suggest: d.suggest }),
    })),
  };
  return JSON.stringify(body, null, 2);
}
