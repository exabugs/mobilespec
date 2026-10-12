// src/core/diagnostic.ts
//
// 診断（検証の結果）。AI が自力で直せるように、機械可読な情報を持つ:
// - file + pointer（JSON ポインタ）で、直す場所が確定する
// - found / expected / suggest で、何が違い、何が有効で、何に直すべきかが分かる
//
// Policy（固定）:
// - error: 実装不能（CI は失敗する）
// - info : 状態の可視化（常に表示）

export type DiagnosticLevel = 'error' | 'info';

export type DiagnosticCode =
  // 読み込み・構造
  | 'APP_NOT_FOUND'
  | 'YAML_PARSE_ERROR'
  | 'SCHEMA_INVALID'
  | 'DUPLICATE_ID'
  | 'INVALID_FILE_ID'
  | 'ORPHAN_LAYER_FILE'
  | 'UNKNOWN_GROUP'
  | 'NAME_COLLISION'
  | 'ID_COLLISION'
  // 置き場所（レイヤーの純度）
  | 'MISPLACED'
  | 'EXPRESSION_NOT_ALLOWED'
  | 'AVAILABILITY_IN_UI'
  // 参照・式
  | 'EXPRESSION_SYNTAX'
  | 'UNKNOWN_REFERENCE'
  | 'INVALID_TYPE'
  | 'TYPE_MISMATCH'
  // L2
  | 'NO_ENTRY'
  | 'UNREACHABLE_SCREEN'
  | 'UNKNOWN_SCREEN'
  | 'PARAMS_MISMATCH'
  | 'AUTO_WITHOUT_CONDITION'
  | 'MULTIPLE_ELSE'
  // L3
  | 'UNKNOWN_ACTION'
  // L4
  | 'UNKNOWN_TRANSITION'
  | 'UNKNOWN_DATA_KEY'
  | 'UNKNOWN_STATE'
  // OpenAPI
  | 'OPENAPI_NOT_FOUND'
  | 'OPENAPI_INVALID'
  | 'UNKNOWN_OPERATION'
  | 'ARGS_MISMATCH'
  // i18n
  | 'I18N_JA_STALE'
  | 'I18N_UNTRANSLATED'
  | 'I18N_MISSING_KEY'
  // info（状態）
  | 'UNUSED_TRANSITION'
  | 'DEAD_END_SCREEN'
  | 'UNUSED_DEFINITION'
  | 'UNKNOWN_TYPE'
  | 'HTTP_IN_TEXT'
  | 'MISSING_DESCRIPTION'
  | 'MISSING_FILE'
  | 'REDUNDANT_DESCRIPTION'
  | 'CONDITION_WITHOUT_EXPR'
  | 'EVENT_WITHOUT_STEPS';

export type Diagnostic = {
  code: DiagnosticCode;
  level: DiagnosticLevel;
  /** 人間が読めるメッセージ */
  message: string;
  /** specs ディレクトリからの相対パス */
  file?: string;
  /** ファイル内の場所（JSON ポインタ） */
  pointer?: string;
  /** 見つかった値 */
  found?: string;
  /** 有効な候補 */
  expected?: string[];
  /** 最も近い候補（綴りの近さ） */
  suggest?: string;
  /** 追加のメタデータ */
  meta?: Record<string, unknown>;
};

export type HasDiagnostics = { diagnostics: Diagnostic[] };

export const errorsOf = (r: HasDiagnostics): Diagnostic[] =>
  r.diagnostics.filter((d) => d.level === 'error');

export const infosOf = (r: HasDiagnostics): Diagnostic[] =>
  r.diagnostics.filter((d) => d.level === 'info');

export const findByCode = (r: HasDiagnostics, code: DiagnosticCode): Diagnostic | undefined =>
  r.diagnostics.find((d) => d.code === code);

export const allByCode = (r: HasDiagnostics, code: DiagnosticCode): Diagnostic[] =>
  r.diagnostics.filter((d) => d.code === code);

/* ================================
 * 候補の提示（綴りの近さ）
 * ================================ */

/** Levenshtein 距離 */
export function distance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/** found に最も近い候補。近さが十分でなければ undefined */
export function closest(found: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = distance(found.toLowerCase(), c.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (best === undefined) return undefined;
  // 綴りの誤りとみなせる範囲（長さに応じて許容を変える）
  const limit = Math.max(2, Math.floor(Math.max(found.length, best.length) / 3));
  return bestD <= limit ? best : undefined;
}

/** 参照・ID などの「見つからない」診断の共通部分（found / expected / suggest を付ける） */
export function notFound(
  base: Pick<Diagnostic, 'code' | 'file' | 'pointer'> & { level?: DiagnosticLevel },
  message: string,
  found: string,
  candidates: readonly string[],
  meta?: Record<string, unknown>
): Diagnostic {
  const suggest = closest(found, candidates);
  return {
    level: 'error',
    ...base,
    message: suggest ? `${message}（もしかして: ${suggest}）` : message,
    found,
    expected: [...candidates].sort(),
    ...(suggest !== undefined && { suggest }),
    ...(meta && { meta }),
  };
}
