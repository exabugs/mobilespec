// src/types/diagnostic.ts

/**
 * 診断レベル
 */
export type DiagnosticLevel = 'error' | 'warning' | 'info';

/**
 * 診断コード一覧
 */
export type DiagnosticCode =
  // OpenAPI関連
  | 'OPENAPI_NOT_FOUND'
  | 'OPENAPI_INVALID'
  | 'OPENAPI_MISSING_OPERATION_ID'
  | 'OPENAPI_DUPLICATE_OPERATION_ID'
  | 'OPENAPI_RESPONSE_SCHEMA_UNRESOLVED'
  | 'L4_INVALID_SELECT_ROOT'
  // L2関連
  | 'L2_INVALID'
  | 'L2_SCHEMA_NOT_FOUND'
  | 'L2_DUPLICATE_SCREEN_ID'
  | 'L2_DUPLICATE_TRANSITION_ID'
  | 'L2_INVALID_TRANSITION_FROM'
  | 'L2_INVALID_TRANSITION_TO'
  // 未使用検知
  | 'L2_TRANSITION_UNUSED'
  // L3関連
  | 'L3_INVALID'
  | 'L3_SCHEMA_NOT_FOUND'
  | 'L3_UNKNOWN_SCREEN'
  | 'L3_UNKNOWN_TRANSITION'
  // L4関連
  | 'L4_INVALID'
  | 'L4_SCHEMA_NOT_FOUND'
  | 'L4_UNKNOWN_SCREEN'
  | 'L4_UNKNOWN_OPERATION_ID'
  | 'L4_UNUSED_OPERATION_ID'
  | 'L4_NO_FILES'
  // L2-L3整合性
  | 'L3_ACTION_NOT_IN_L2'
  // L2-L4整合性
  | 'L2_TRANSITION_NOT_IN_L4'
  // L4内部整合性
  | 'L4_UNKNOWN_QUERY'
  | 'L4_UNKNOWN_MUTATION'
  // i18n関連
  | 'I18N_MISSING_KEY'
  | 'I18N_UNTRANSLATED';

/**
 * 構造化診断情報
 */
export type Diagnostic = {
  /** 診断コード */
  code: DiagnosticCode;
  /** 診断レベル */
  level: DiagnosticLevel;
  /** 人間が読めるメッセージ */
  message: string;
  /** 追加のメタデータ */
  meta?: Record<string, unknown>;
};

export type HasDiagnostics = {
  diagnostics: Diagnostic[];
};

export function errorsOf(r: HasDiagnostics): Diagnostic[] {
  return r.diagnostics.filter((d) => d.level === 'error');
}

export function warningsOf(r: HasDiagnostics): Diagnostic[] {
  return r.diagnostics.filter((d) => d.level === 'warning');
}

export function infosOf(r: HasDiagnostics): Diagnostic[] {
  return r.diagnostics.filter((d) => d.level === 'info');
}

export function findByCode<T extends HasDiagnostics>(
  r: T,
  code: DiagnosticCode
): Diagnostic | undefined {
  return r.diagnostics.find((d) => d.code === code);
}
