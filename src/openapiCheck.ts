// src/openapiCheck.ts
import fg from 'fast-glob';
import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { compileSchemaFromDir } from './lib/ajv.js';
import { formatUnused } from './lib/formatUnused.js';
import type { Diagnostic, HasDiagnostics } from './types/diagnostic.js';

export type OpenapiCheckOptions = {
  specsDir: string;
  schemaDir: string;
  openapiPath: string;
};

export type OpenapiCheckResult = HasDiagnostics;

function asResult(diagnostics: Diagnostic[]): OpenapiCheckResult {
  return { diagnostics };
}

/* ================================
 * Zod Schemas
 * ================================ */

const OpenApiOperationSchema = z.looseObject({
  operationId: z.string().min(1).optional(),
  responses: z.record(z.string(), z.unknown()).optional(),
});
const OpenApiPathItemSchema = z.record(z.string(), OpenApiOperationSchema);
const OpenApiSchema = z.looseObject({
  openapi: z.string().optional(),
  swagger: z.string().optional(),
  paths: z.record(z.string(), OpenApiPathItemSchema).optional(),
  components: z.unknown().optional(),
});

const HttpMethodSchema = z.enum([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

function readYamlUnknown(p: string): unknown {
  return yaml.load(fs.readFileSync(p, 'utf8'));
}

function zodIssuesToText(issues: z.ZodIssue[]) {
  return issues.map((i) => `${i.path.join('/')}: ${i.message}`).join(', ');
}

type OpenApiDoc = z.infer<typeof OpenApiSchema>;
type OpenApiPathItem = z.infer<typeof OpenApiPathItemSchema>;
type OpenApiOperation = z.infer<typeof OpenApiOperationSchema>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/* ================================
 * OpenAPI 解析
 * ================================ */

function pickFirst2xxJsonSchema(op: OpenApiOperation): unknown | null {
  const responses = op.responses;
  if (!responses || !isRecord(responses)) return null;

  const codes = Object.keys(responses)
    .filter((k) => /^\d{3}$/.test(k))
    .sort((a, b) => Number(a) - Number(b));

  for (const code of codes) {
    if (!code.startsWith('2')) continue;

    const r = responses[code];
    if (!isRecord(r)) continue;

    const content = r['content'];
    if (!isRecord(content)) continue;

    const appJson = content['application/json'];
    if (isRecord(appJson) && isRecord(appJson['schema'])) return appJson['schema'];

    for (const [ct, body] of Object.entries(content)) {
      if (!ct.includes('json')) continue;
      if (isRecord(body) && isRecord(body['schema'])) return body['schema'];
    }
  }

  return null;
}

type ResponseRootKeys =
  | { kind: 'keys'; keys: Set<string> }
  | { kind: 'unresolved'; reason: string };

function decodeJsonPointerToken(s: string): string {
  return s.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveJsonPointer(doc: unknown, ref: string): unknown | null {
  if (!ref.startsWith('#/')) return null;
  if (!isRecord(doc)) return null;

  const parts = ref.slice(2).split('/').map(decodeJsonPointerToken);

  let cur: unknown = doc;
  for (const part of parts) {
    if (!isRecord(cur)) return null;
    cur = cur[part];
  }
  return cur ?? null;
}

function extractRootKeysFromSchema(doc: unknown, schema: unknown, depth = 0): ResponseRootKeys {
  if (depth > 16) return { kind: 'unresolved', reason: 'ref depth limit' };
  if (!isRecord(schema)) return { kind: 'unresolved', reason: 'schema is not an object' };

  const ref = schema['$ref'];
  if (typeof ref === 'string') {
    const resolved = resolveJsonPointer(doc, ref);
    if (!resolved) return { kind: 'unresolved', reason: `cannot resolve $ref: ${ref}` };
    return extractRootKeysFromSchema(doc, resolved, depth + 1);
  }

  const props = schema['properties'];
  if (isRecord(props)) return { kind: 'keys', keys: new Set(Object.keys(props)) };

  return { kind: 'unresolved', reason: 'schema.properties is missing' };
}

function collectOperationIdsFromOpenApi(doc: OpenApiDoc) {
  const opIds = new Set<string>();
  const occurrences = new Map<string, string[]>();
  const missing: string[] = [];
  const rootKeysByOpId = new Map<string, ResponseRootKeys>();

  const paths = doc.paths ?? {};

  for (const [p, pathItem] of Object.entries(paths) as [string, OpenApiPathItem][]) {
    for (const [methodRaw, op] of Object.entries(pathItem) as [string, OpenApiOperation][]) {
      const m = methodRaw.toLowerCase();
      if (!HttpMethodSchema.safeParse(m).success) continue;

      const label = `${m.toUpperCase()} ${p}`;
      const operationId = op.operationId;

      if (!operationId || operationId.trim() === '') {
        missing.push(label);
        continue;
      }

      opIds.add(operationId);
      const arr = occurrences.get(operationId) ?? [];
      arr.push(label);
      occurrences.set(operationId, arr);

      const schema = pickFirst2xxJsonSchema(op);
      if (schema) {
        rootKeysByOpId.set(operationId, extractRootKeysFromSchema(doc, schema));
      } else {
        rootKeysByOpId.set(operationId, {
          kind: 'unresolved',
          reason: 'no 2xx application/json schema',
        });
      }
    }
  }

  return { opIds, occurrences, missing, rootKeysByOpId };
}

/* ================================
 * L4 参照収集
 * ================================ */

type L4Ref = {
  screenId: string;
  kind: 'query' | 'mutation';
  name: string;
  operationId: string;
  selectRoot?: string;
  file: string;
};

function collectOperationIdRefsFromL4(specsDir: string, schemaDir: string) {
  const L4_DIR = path.join(specsDir, 'L4.state');
  const l4Files = fs.existsSync(L4_DIR)
    ? fg.sync(['**/*.state.yaml'], { cwd: L4_DIR, absolute: true })
    : [];

  const refs: L4Ref[] = [];
  const errors: Diagnostic[] = [];

  const validate = compileSchemaFromDir(schemaDir, 'L4.state.schema.json');

  for (const f of l4Files) {
    const raw = readYamlUnknown(f);
    const ok = validate(raw);

    if (!ok) {
      errors.push({
        code: 'L4_INVALID',
        level: 'error',
        message: `L4 invalid: ${path.relative(specsDir, f)}`,
      });
      continue;
    }

    if (!isRecord(raw)) continue;
    const screen = raw['screen'];
    if (!isRecord(screen)) continue;

    const screenId = String(screen['id'] ?? '');
    const data = screen['data'];
    if (!isRecord(data)) continue;

    const collect = (obj: unknown, kind: 'query' | 'mutation') => {
      if (!isRecord(obj)) return;
      for (const [name, v] of Object.entries(obj)) {
        if (!isRecord(v)) continue;
        const operationId = v['operationId'];
        const selectRoot = v['selectRoot'];
        if (typeof operationId === 'string' && operationId.trim() !== '') {
          refs.push({
            screenId,
            kind,
            name,
            operationId,
            selectRoot:
              typeof selectRoot === 'string' && selectRoot.trim() !== '' ? selectRoot : undefined,
            file: f,
          });
        }
      }
    };

    collect(data['queries'], 'query');
    collect(data['mutations'], 'mutation');
  }

  return { refs, l4Files, errors };
}

/* ================================
 * main
 * ================================ */

export async function openapiCheck(opts: OpenapiCheckOptions): Promise<OpenapiCheckResult> {
  const diagnostics: Diagnostic[] = [];

  if (!fs.existsSync(opts.openapiPath)) {
    diagnostics.push({
      code: 'OPENAPI_NOT_FOUND',
      level: 'error',
      message: `OpenAPI が見つかりません: ${opts.openapiPath}`,
    });
    return asResult(diagnostics);
  }

  const openapiRaw = readYamlUnknown(opts.openapiPath);
  const parsed = OpenApiSchema.safeParse(openapiRaw);
  if (!parsed.success) {
    diagnostics.push({
      code: 'OPENAPI_INVALID',
      level: 'error',
      message: `OpenAPI invalid: ${zodIssuesToText(parsed.error.issues)}`,
    });
    return asResult(diagnostics);
  }

  const { opIds, occurrences, missing, rootKeysByOpId } = collectOperationIdsFromOpenApi(
    parsed.data
  );

  if (missing.length) {
    diagnostics.push({
      code: 'OPENAPI_MISSING_OPERATION_ID',
      level: 'error',
      message: `operationId が無い operation: ${missing.join(', ')}`,
    });
  }

  const { refs, l4Files, errors } = collectOperationIdRefsFromL4(opts.specsDir, opts.schemaDir);

  diagnostics.push(...errors);

  if (l4Files.length === 0) {
    diagnostics.push({
      code: 'L4_NO_FILES',
      level: 'info',
      message: 'L4.state が無いため OpenAPI 突合をスキップ',
    });
    return asResult(diagnostics);
  }

  /* ---------------------------
     L4 -> OpenAPI
  --------------------------- */

  for (const r of refs) {
    if (!opIds.has(r.operationId)) {
      diagnostics.push({
        code: 'L4_UNKNOWN_OPERATION_ID',
        level: 'error',
        message: `存在しない operationId: ${r.operationId}`,
      });
      continue;
    }

    // ★ 常時 selectRoot 検証
    if (r.selectRoot) {
      const info = rootKeysByOpId.get(r.operationId);

      if (!info) {
        diagnostics.push({
          code: 'OPENAPI_RESPONSE_SCHEMA_UNRESOLVED',
          level: 'error',
          message: `selectRoot を検証できない（schema未取得）: ${r.operationId}`,
        });
      } else if (info.kind === 'unresolved') {
        diagnostics.push({
          code: 'OPENAPI_RESPONSE_SCHEMA_UNRESOLVED',
          level: 'error',
          message: `selectRoot を検証できない（schema未解決）: ${r.operationId}`,
        });
      } else if (!info.keys.has(r.selectRoot)) {
        diagnostics.push({
          code: 'L4_INVALID_SELECT_ROOT',
          level: 'error',
          message: `selectRoot 不正: ${r.operationId} -> ${r.selectRoot}`,
        });
      }
    }
  }

  /* ---------------------------
     OpenAPI -> L4 (unused)
  --------------------------- */

  const used = new Set(refs.map((r) => r.operationId));
  const unused = [...opIds].filter((id) => !used.has(id));

  if (unused.length) {
    const message = formatUnused(
      'OpenAPI operationId が L4 から未参照',
      unused.map((id) => ({
        key: id,
        labels: occurrences.get(id) ?? [],
      }))
    );

    diagnostics.push({
      code: 'L4_UNUSED_OPERATION_ID',
      level: 'info',
      message,
    });
  }

  return asResult(diagnostics);
}
