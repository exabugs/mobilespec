// src/core/openapi.ts
//
// OpenAPI（bundled）の読み込み。mobilespec が必要とするのは、operationId と、その入出力の概要だけ。
// API の説明・型の正は OpenAPI（D9）。仕様には写さず、ここから引く。
import yaml from 'js-yaml';
import fs from 'node:fs';

import { isObj } from './model.js';

export type OpParam = { name: string; in: string; required: boolean; type: string };

export type Operation = {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  params: OpParam[];
  /** リクエストボディ（JSON）のトップレベルのフィールド */
  body?: { required: boolean; props: Array<{ name: string; required: boolean; type: string }> };
  /** 成功時の応答の型（概要） */
  response?: string;
};

export type OpenApiIndex = {
  file: string;
  operations: Map<string, Operation>;
};

export type OpenApiLoad = { ok: true; index: OpenApiIndex } | { ok: false; message: string };

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

type Json = Record<string, unknown>;

function resolveRef(root: Json, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let cur: unknown = root;
  for (const seg of ref.slice(2).split('/')) {
    if (!isObj(cur)) return undefined;
    cur = cur[seg.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return cur;
}

function deref(root: Json, v: unknown, depth = 0): unknown {
  if (isObj(v) && typeof v.$ref === 'string' && depth < 10) {
    return deref(root, resolveRef(root, v.$ref), depth + 1);
  }
  return v;
}

/** スキーマを短い型の文字列にする（概要。深さを制限する） */
export function schemaToType(root: Json, schema: unknown, depth = 0): string {
  if (isObj(schema) && typeof schema.$ref === 'string') {
    return schema.$ref.split('/').pop() ?? 'ref';
  }
  const s = deref(root, schema);
  if (!isObj(s)) return 'unknown';
  if (Array.isArray(s.oneOf) || Array.isArray(s.anyOf)) {
    const list = (s.oneOf ?? s.anyOf) as unknown[];
    return list.map((x) => schemaToType(root, x, depth + 1)).join(' | ');
  }
  if (Array.isArray(s.allOf))
    return s.allOf.map((x) => schemaToType(root, x, depth + 1)).join(' & ');
  const t = s.type;
  if (t === 'array') return `[${schemaToType(root, s.items, depth + 1)}]`;
  if (t === 'object' || isObj(s.properties)) {
    if (depth >= 1 || !isObj(s.properties)) return 'object';
    const req = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
    const fields = Object.entries(s.properties as Json).map(
      ([k, v]) => `${k}${req.has(k) ? '' : '?'}: ${schemaToType(root, v, depth + 1)}`
    );
    return `{ ${fields.join(', ')} }`;
  }
  if (typeof t === 'string') return Array.isArray(s.enum) ? `${t}(enum)` : t;
  return 'unknown';
}

function paramList(root: Json, pathItem: Json, op: Json): OpParam[] {
  const all = [
    ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
    ...(Array.isArray(op.parameters) ? op.parameters : []),
  ];
  const out = new Map<string, OpParam>();
  for (const p of all) {
    const r = deref(root, p);
    if (!isObj(r) || typeof r.name !== 'string') continue;
    out.set(`${r.in}:${r.name}`, {
      name: r.name,
      in: String(r.in),
      required: r.required === true || r.in === 'path',
      type: schemaToType(root, r.schema),
    });
  }
  return [...out.values()];
}

function bodyOf(root: Json, op: Json): Operation['body'] {
  const rb = deref(root, op.requestBody);
  if (!isObj(rb) || !isObj(rb.content)) return undefined;
  const json = (rb.content as Json)['application/json'];
  if (!isObj(json)) return undefined;
  const schema = deref(root, json.schema);
  if (!isObj(schema) || !isObj(schema.properties))
    return { required: rb.required === true, props: [] };
  const req = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  return {
    required: rb.required === true,
    props: Object.entries(schema.properties as Json).map(([name, v]) => ({
      name,
      required: req.has(name),
      type: schemaToType(root, v, 1),
    })),
  };
}

function responseOf(root: Json, op: Json): string | undefined {
  if (!isObj(op.responses)) return undefined;
  for (const code of Object.keys(op.responses).sort()) {
    if (!/^2\d\d$/.test(code)) continue;
    const r = deref(root, (op.responses as Json)[code]);
    if (!isObj(r)) continue;
    const json = isObj(r.content) ? (r.content as Json)['application/json'] : undefined;
    if (isObj(json)) return schemaToType(root, json.schema);
    return 'void';
  }
  return undefined;
}

export function loadOpenApi(absPath: string): OpenApiLoad {
  let text: string;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    return { ok: false, message: `OpenAPI を読めません: ${(e as Error).message}` };
  }
  let root: unknown;
  try {
    root = yaml.load(text);
  } catch (e) {
    return {
      ok: false,
      message: `OpenAPI の構文エラー: ${String((e as Error).message).split('\n')[0]}`,
    };
  }
  if (!isObj(root) || !isObj(root.paths)) {
    return { ok: false, message: 'OpenAPI に paths がありません' };
  }

  const operations = new Map<string, Operation>();
  for (const [p, item] of Object.entries(root.paths as Json)) {
    if (!isObj(item)) continue;
    for (const m of METHODS) {
      const op = item[m];
      if (!isObj(op) || typeof op.operationId !== 'string') continue;
      operations.set(op.operationId, {
        operationId: op.operationId,
        method: m.toUpperCase(),
        path: p,
        ...(typeof op.summary === 'string' && { summary: op.summary }),
        ...(typeof op.description === 'string' && { description: op.description }),
        params: paramList(root, item, op),
        body: bodyOf(root, op),
        response: responseOf(root, op),
      });
    }
  }
  return { ok: true, index: { file: absPath, operations } };
}

/** メソッド + パスから operationId を引く（migrate 用。`{id}` と `{venueId}` の違いは無視する） */
export function findOperation(
  index: OpenApiIndex,
  method: string,
  pathTemplate: string
): Operation | undefined {
  const norm = (s: string) => s.replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '');
  const want = norm(pathTemplate.split('?')[0]);
  for (const op of index.operations.values()) {
    if (op.method === method.toUpperCase() && norm(op.path) === want) return op;
  }
  return undefined;
}
