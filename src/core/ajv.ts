// src/core/ajv.ts — JSON Schema（AJV）による構造の検証と、読みやすい診断への変換
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Diagnostic } from './diagnostic.js';

const require = createRequire(import.meta.url);
const AjvClass =
  (require('ajv/dist/2020') as { default?: unknown }).default ?? require('ajv/dist/2020');

type AjvError = {
  instancePath?: string;
  schemaPath?: string;
  keyword?: string;
  message?: string;
  params?: Record<string, unknown>;
};
type Validator = { (data: unknown): boolean; errors?: AjvError[] | null };
type AjvInstance = { compile: (schema: Record<string, unknown>) => Validator };

export const DEFAULT_SCHEMA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'schema'
);

export type SchemaName = 'app' | 'L2' | 'L3' | 'L4';

const FILES: Record<SchemaName, string> = {
  app: 'app.schema.json',
  L2: 'L2.screenflows.schema.json',
  L3: 'L3.ui.schema.json',
  L4: 'L4.state.schema.json',
};

const cache = new Map<string, Validator>();

function validatorFor(schemaDir: string, name: SchemaName): Validator | null {
  const file = path.join(schemaDir, FILES[name]);
  const hit = cache.get(file);
  if (hit) return hit;
  if (!fs.existsSync(file)) return null;
  const ajv = new (AjvClass as new (o: { strict: boolean; allErrors: boolean }) => AjvInstance)({
    strict: false,
    allErrors: true,
  });
  const v = ajv.compile(JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>);
  cache.set(file, v);
  return v;
}

/**
 * 置き場所の誤りの案内（S4: レイヤーの純度は構造で強制し、正しい置き場所を教える）
 * キー: `${スキーマ名}:${余分なプロパティ名}`
 */
export const MISPLACED_HINTS: Record<string, string> = {
  'L2:id': '画面の ID はファイル名です。ファイルの中に id は書きません',
  'L2:screen': '`screen:` の包みは不要です。ファイルの最上位が、その画面そのものです',
  'L2:type': '画面の種類（screen / choice）は書きません。auto の遷移だけを持つ画面が分岐です',
  'L2:exit': '終端は書きません。遷移が無い画面が終端として扱われます',
  'L2:trigger':
    '遷移の起動のしかたは書きません。L3 の action / L4 の go の参照から導きます（自動なら auto: true）',
  'L2:guard': '`guard`（名前）ではなく `when`（参照）を書きます',
  'L3:id': '画面の ID はファイル名です。ファイルの中に id は書きません',
  'L3:screen': '`screen:` の包みは不要です。ファイルの最上位が、その画面そのものです',
  'L4:id': '画面の ID はファイル名です。ファイルの中に id は書きません',
  'L4:screen': '`screen:` の包みは不要です。ファイルの最上位が、その画面そのものです',
  'L4:target':
    '遷移の行き先は L2 の transitions に書きます。L4 からは `go: <遷移 ID>` で参照します',
  'L4:navigate':
    '遷移の行き先は L2 の transitions に書きます。L4 からは `go: <遷移 ID>` で参照します',
  'L4:stack':
    '複数画面にまたがる遷移は L2 の transitions の `stack:` に書きます。L4 からは `go` で参照します',
  'L4:stateData': '`stateData` は廃止です。型付きの `state`（name / type / default）に書きます',
  'L4:dataSource': '`dataSource` は廃止です。`data.queries`（operationId / args）に書きます',
  'L4:onEnterEffects':
    '`onEnterEffects` は廃止です。`events` に `on: enter` のイベントとして書きます',
  'L4:guard': '`guard`（名前）ではなく `when`（参照）を書きます',
};

function describe(
  err: AjvError,
  schema: SchemaName
): { message: string; misplaced?: boolean } | null {
  const params = err.params ?? {};
  switch (err.keyword) {
    case 'if':
      return null; // if/then の補助エラー（原因のエラーが別に出る）
    case 'additionalProperties': {
      const prop = String(params.additionalProperty);
      const hint = MISPLACED_HINTS[`${schema}:${prop}`];
      return hint
        ? { message: `"${prop}" はここに書けません。${hint}`, misplaced: true }
        : { message: `未定義のプロパティ "${prop}" があります` };
    }
    case 'required':
      return { message: `必須プロパティ "${String(params.missingProperty)}" がありません` };
    case 'enum': {
      const allowed = Array.isArray(params.allowedValues) ? params.allowedValues.join(' | ') : '';
      return { message: `値が不正です（許可: ${allowed}）` };
    }
    case 'const':
      return { message: `値が不正です（許可: ${String(params.allowedValue)}）` };
    case 'pattern':
      // propertyNames の中の pattern は、propertyNames のエラーが別に出る
      if ((err.schemaPath ?? '').includes('/propertyNames/')) return null;
      return { message: `形式が不正です（pattern: ${String(params.pattern)}）` };
    case 'propertyNames':
      return {
        message: `名前 "${String(params.propertyName)}" が不正です（命名規則に合いません）`,
      };
    case 'oneOf':
      return { message: '遷移には target か stack のどちらか一方が必要です' };
    default:
      return { message: err.message || 'unknown error' };
  }
}

/** ドキュメントをスキーマで検証し、診断を返す（同じ場所・同じ内容の重複はまとめる） */
export function validateAgainstSchema(
  data: unknown,
  file: string,
  schema: SchemaName,
  schemaDir: string = DEFAULT_SCHEMA_DIR
): Diagnostic[] {
  const v = validatorFor(schemaDir, schema);
  if (!v) {
    return [
      {
        code: 'SCHEMA_INVALID',
        level: 'error',
        file,
        message: `スキーマが見つかりません: ${path.join(schemaDir, FILES[schema])}`,
      },
    ];
  }
  if (v(data) || !v.errors) return [];

  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const err of v.errors) {
    const d = describe(err, schema);
    if (!d) continue;
    const pointer = err.instancePath ?? '';
    const key = `${pointer}\u0000${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      code: d.misplaced ? 'MISPLACED' : 'SCHEMA_INVALID',
      level: 'error',
      file,
      pointer,
      message: `${pointer || '/'} ${d.message}`,
    });
  }
  return out;
}
