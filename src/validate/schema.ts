import fs from 'fs';
import { createRequire } from 'node:module';

import type { Diagnostic } from '../types/diagnostic.js';
import { schemaError, schemaNotFound } from './diagnostics.js';
import type { YamlFile } from './io.js';

const require = createRequire(import.meta.url);
const AjvClass =
  (require('ajv/dist/2020') as { default?: unknown }).default ?? require('ajv/dist/2020');

export type AjvErrorLike = {
  instancePath?: string;
  keyword?: string;
  message?: string;
  params?: Record<string, unknown>;
};

type AjvInstance = {
  compile: (schema: Record<string, unknown>) => {
    (data: unknown): boolean;
    errors?: AjvErrorLike[] | null;
  };
};

/**
 * AJV のエラーを、人間が直せるメッセージにする。
 * - どのプロパティが問題かを明示する（additionalProperties / required / enum / const / pattern）
 * - if/then の補助エラー（"must match "then" schema"）は、原因のエラーが別に出るので捨てる
 */
export function describeAjvError(err: AjvErrorLike): string | null {
  const params = err.params ?? {};
  switch (err.keyword) {
    case 'if':
      return null;
    case 'additionalProperties':
      return `未定義のプロパティ "${String(params.additionalProperty)}" があります`;
    case 'required':
      return `必須プロパティ "${String(params.missingProperty)}" がありません`;
    case 'enum': {
      const allowed = Array.isArray(params.allowedValues) ? params.allowedValues.join(' | ') : '';
      return `値が不正です（許可: ${allowed}）`;
    }
    case 'const':
      return `値が不正です（許可: ${String(params.allowedValue)}）`;
    case 'pattern':
      return `形式が不正です（pattern: ${String(params.pattern)}）`;
    default:
      return err.message || 'unknown error';
  }
}

/** 同じ場所・同じ内容のエラーを 1 件にまとめる（allErrors で重複して出るため） */
export function simplifyAjvErrors(
  errors: AjvErrorLike[]
): Array<{ path: string; message: string }> {
  const seen = new Set<string>();
  const out: Array<{ path: string; message: string }> = [];
  for (const err of errors) {
    const message = describeAjvError(err);
    if (message === null) continue;
    const p = err.instancePath || '/';
    const key = `${p}\u0000${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: p, message });
  }
  return out;
}

/* ================================
 * Schema Validation
 * ================================ */

export function validateSchema(
  files: YamlFile[],
  schemaPath: string,
  label: 'L2' | 'L3' | 'L4'
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!fs.existsSync(schemaPath)) {
    diagnostics.push(schemaNotFound(label, schemaPath));
    return diagnostics;
  }

  const schemaData = JSON.parse(fs.readFileSync(schemaPath, 'utf-8')) as Record<string, unknown>;
  const ajv = new (AjvClass as new (options: {
    strict: boolean;
    allErrors: boolean;
  }) => AjvInstance)({
    strict: false,
    allErrors: true,
  });
  const validate = ajv.compile(schemaData);

  for (const file of files) {
    const valid = validate(file.data);
    if (!valid && validate.errors) {
      for (const { path: p, message } of simplifyAjvErrors(validate.errors)) {
        diagnostics.push(schemaError(label, file.path, p, message));
      }
    }
  }

  return diagnostics;
}
