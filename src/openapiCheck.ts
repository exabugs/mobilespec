// src/openapiCheck.ts
import fg from 'fast-glob';
import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { compileSchemaFromDir } from './lib/ajv.js';
import type { Diagnostic, DiagnosticResult } from './types/diagnostic.js';

export type OpenapiCheckOptions = {
  specsDir: string;
  schemaDir: string;
  openapiPath: string;

  // ★追加（config から注入）
  warnUnusedOperationId: boolean;
  checkSelectRoot: boolean;
};

export type OpenapiCheckResult = DiagnosticResult;

function asResult(diagnostics: Diagnostic[]): OpenapiCheckResult {
  return {
    diagnostics,
    get errors() {
      return diagnostics.filter((d) => d.level === 'error');
    },
    get warnings() {
      return diagnostics.filter((d) => d.level === 'warning');
    },
  };
}

// ------------------------------------
// Zod schemas (OpenAPI only)
// ------------------------------------

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

// ------------------------------------
// OpenAPI response schema -> root keys (bundle-aware)
// ------------------------------------

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

  const allOf = schema['allOf'];
  if (Array.isArray(allOf)) {
    const merged = new Set<string>();
    let any = false;
    for (const s of allOf) {
      const r = extractRootKeysFromSchema(doc, s, depth + 1);
      if (r.kind === 'keys') {
        any = true;
        for (const k of r.keys) merged.add(k);
      }
    }
    if (any) return { kind: 'keys', keys: merged };
    return { kind: 'unresolved', reason: 'allOf but no properties' };
  }

  if (Array.isArray(schema['oneOf'])) return { kind: 'unresolved', reason: 'oneOf schema' };
  if (Array.isArray(schema['anyOf'])) return { kind: 'unresolved', reason: 'anyOf schema' };

  return { kind: 'unresolved', reason: 'schema.properties is missing' };
}

function collectOperationIdsFromOpenApi(doc: OpenApiDoc): {
  opIds: Set<string>;
  duplicates: Map<string, string[]>;
  missing: string[];
  rootKeysByOpId: Map<string, ResponseRootKeys>;
} {
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

  const duplicates = new Map<string, string[]>();
  for (const [id, where] of occurrences.entries()) {
    if (where.length > 1) duplicates.set(id, where);
  }

  return { opIds, duplicates, missing, rootKeysByOpId };
}

// ------------------------------------
// L4 refs (AJV) + selectRoot
// ------------------------------------

type L4Ref = {
  screenId: string;
  kind: 'query' | 'mutation';
  name: string;
  operationId: string;
  selectRoot?: string;
  file: string;
};

function collectOperationIdRefsFromL4(
  specsDir: string,
  schemaDir: string
): {
  refs: L4Ref[];
  l4Files: string[];
  errors: Diagnostic[];
} {
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
      const details =
        validate.errors
          ?.map((e) => `${e.instancePath || '/'} ${e.message || ''}`.trim())
          .join(', ') ?? 'unknown error';
      errors.push({
        code: 'L4_INVALID',
        level: 'error',
        message: `L4 invalid: ${path.relative(specsDir, f)}: ${details}`,
        meta: { file: path.relative(specsDir, f), details },
      });
      continue;
    }

    if (!isRecord(raw)) continue;
    const screen = raw['screen'];
    if (!isRecord(screen)) continue;

    const screenId = String(screen['id'] ?? '');
    const data = screen['data'];
    if (!isRecord(data)) continue;

    const queries = data['queries'];
    if (isRecord(queries)) {
      for (const [name, q] of Object.entries(queries)) {
        if (!isRecord(q)) continue;
        const operationId = q['operationId'];
        const selectRoot = q['selectRoot'];
        if (typeof operationId === 'string' && operationId.trim() !== '') {
          refs.push({
            screenId,
            kind: 'query',
            name,
            operationId,
            selectRoot:
              typeof selectRoot === 'string' && selectRoot.trim() !== '' ? selectRoot : undefined,
            file: f,
          });
        }
      }
    }

    const mutations = data['mutations'];
    if (isRecord(mutations)) {
      for (const [name, m] of Object.entries(mutations)) {
        if (!isRecord(m)) continue;
        const operationId = m['operationId'];
        const selectRoot = m['selectRoot'];
        if (typeof operationId === 'string' && operationId.trim() !== '') {
          refs.push({
            screenId,
            kind: 'mutation',
            name,
            operationId,
            selectRoot:
              typeof selectRoot === 'string' && selectRoot.trim() !== '' ? selectRoot : undefined,
            file: f,
          });
        }
      }
    }
  }

  return { refs, l4Files, errors };
}

// ------------------------------------
// main
// ------------------------------------

export async function openapiCheck(opts: OpenapiCheckOptions): Promise<OpenapiCheckResult> {
  const diagnostics: Diagnostic[] = [];

  if (!fs.existsSync(opts.openapiPath)) {
    diagnostics.push({
      code: 'OPENAPI_NOT_FOUND',
      level: 'error',
      message: `OpenAPI が見つかりません: ${opts.openapiPath}`,
      meta: { path: opts.openapiPath },
    });
    return asResult(diagnostics);
  }

  // ---- OpenAPI parse ----
  const openapiRaw = readYamlUnknown(opts.openapiPath);
  const openapiParsed = OpenApiSchema.safeParse(openapiRaw);
  if (!openapiParsed.success) {
    diagnostics.push({
      code: 'OPENAPI_INVALID',
      level: 'error',
      message: `OpenAPI invalid: ${zodIssuesToText(openapiParsed.error.issues)}`,
      meta: { issues: openapiParsed.error.issues },
    });
    return asResult(diagnostics);
  }

  const { opIds, duplicates, missing, rootKeysByOpId } = collectOperationIdsFromOpenApi(
    openapiParsed.data
  );

  // ---- OpenAPI quality ----
  if (missing.length) {
    diagnostics.push({
      code: 'OPENAPI_MISSING_OPERATION_ID',
      level: 'error',
      message: `OpenAPI に operationId が無い operation: ${missing.join(', ')}`,
      meta: { operations: missing },
    });
  }

  if (duplicates.size) {
    const lines = [...duplicates.entries()]
      .map(([id, where]) => `  - ${id}: ${where.join(', ')}`)
      .join('\n');
    diagnostics.push({
      code: 'OPENAPI_DUPLICATE_OPERATION_ID',
      level: 'error',
      message: `OpenAPI operationId が重複（operationId は一意が必須）:\n${lines}`,
      meta: { duplicates: Object.fromEntries(duplicates) },
    });
  }

  // ---- L4 refs ----
  const {
    refs,
    l4Files,
    errors: l4Errors,
  } = collectOperationIdRefsFromL4(opts.specsDir, opts.schemaDir);
  diagnostics.push(...l4Errors);

  if (l4Files.length === 0) {
    diagnostics.push({
      code: 'L4_NO_FILES',
      level: 'warning',
      message: 'L4.state が無いため、OpenAPI との突合をスキップしました',
    });
    return asResult(diagnostics);
  }

  // ---- L4 -> OpenAPI ----
  for (const r of refs) {
    if (!opIds.has(r.operationId)) {
      diagnostics.push({
        code: 'L4_UNKNOWN_OPERATION_ID',
        level: 'error',
        message: `L4 が存在しない operationId を参照: ${r.operationId} (${r.kind}:${r.name}) screen=${r.screenId} file=${path.relative(
          opts.specsDir,
          r.file
        )}`,
        meta: {
          operationId: r.operationId,
          kind: r.kind,
          name: r.name,
          screenId: r.screenId,
          file: path.relative(opts.specsDir, r.file),
        },
      });
      continue;
    }

    if (opts.checkSelectRoot && r.selectRoot) {
      const info = rootKeysByOpId.get(r.operationId);
      if (!info) {
        diagnostics.push({
          code: 'OPENAPI_RESPONSE_SCHEMA_UNRESOLVED',
          level: 'warning',
          message: `OpenAPI response schema を取得できず selectRoot を検証できません: operationId=${r.operationId}`,
          meta: { operationId: r.operationId, screenId: r.screenId, kind: r.kind, name: r.name },
        });
      } else if (info.kind === 'unresolved') {
        diagnostics.push({
          code: 'OPENAPI_RESPONSE_SCHEMA_UNRESOLVED',
          level: 'warning',
          message: `OpenAPI response schema を解決できず selectRoot を検証できません: operationId=${r.operationId} reason=${info.reason}`,
          meta: {
            operationId: r.operationId,
            reason: info.reason,
            screenId: r.screenId,
            kind: r.kind,
            name: r.name,
          },
        });
      } else {
        if (!info.keys.has(r.selectRoot)) {
          diagnostics.push({
            code: 'L4_INVALID_SELECT_ROOT',
            level: 'warning',
            message: `L4 selectRoot が OpenAPI レスポンスのrootに存在しません: operationId=${r.operationId} selectRoot=${r.selectRoot}`,
            meta: {
              operationId: r.operationId,
              selectRoot: r.selectRoot,
              availableRoots: [...info.keys].sort((a, b) => a.localeCompare(b)),
              screenId: r.screenId,
              kind: r.kind,
              name: r.name,
            },
          });
        }
      }
    }
  }

  // ---- OpenAPI -> L4 ----
  if (opts.warnUnusedOperationId) {
    const used = new Set(refs.map((r) => r.operationId));
    const unused = [...opIds].filter((id) => !used.has(id));
    if (unused.length) {
      diagnostics.push({
        code: 'L4_UNUSED_OPERATION_ID',
        level: 'warning',
        message: `OpenAPI operationId が L4 から未参照（導入期ならOK）: ${unused.join(', ')}`,
        meta: { operationIds: unused },
      });
    }
  }

  return asResult(diagnostics);
}
