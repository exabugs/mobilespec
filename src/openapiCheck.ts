// src/openapiCheck.ts
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import yaml from 'js-yaml';
import { z } from 'zod';
import { compileSchemaFromDir } from './lib/ajv.js';

export type OpenapiCheckOptions = {
  specsDir: string;
  schemaDir: string; // ★ ここを使う（L4.state.schema.json）
  openapiPath: string;
};

export type OpenapiCheckResult = {
  errors: string[];
  warnings: string[];
};

// ------------------------------------
// Zod schemas (OpenAPI only)
// ------------------------------------

// OpenAPI: operationId だけ拾う。他は全部無視したいので "looseObject"
const OpenApiOperationSchema = z.looseObject({
  operationId: z.string().min(1).optional(),
});

// pathItem: { get: {operationId?}, post: {...}, ... }
const OpenApiPathItemSchema = z.record(z.string(), OpenApiOperationSchema);

// openapi doc: paths: Record<path, pathItem>
const OpenApiSchema = z.looseObject({
  openapi: z.string().optional(),
  swagger: z.string().optional(),
  paths: z.record(z.string(), OpenApiPathItemSchema).optional(),
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

function collectOperationIdsFromOpenApi(doc: OpenApiDoc): {
  opIds: Set<string>;
  duplicates: Map<string, string[]>;
  missing: string[];
} {
  const opIds = new Set<string>();
  const occurrences = new Map<string, string[]>();
  const missing: string[] = [];

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
    }
  }

  const duplicates = new Map<string, string[]>();
  for (const [id, where] of occurrences.entries()) {
    if (where.length > 1) duplicates.set(id, where);
  }

  return { opIds, duplicates, missing };
}

// ------------------------------------
// AJV (L4 validation)
// ------------------------------------

// const require = createRequire(import.meta.url);
// const Ajv = (require('ajv/dist/2020') as any).default ?? require('ajv/dist/2020');

type L4Ref = {
  screenId: string;
  kind: 'query' | 'mutation';
  name: string;
  operationId: string;
  file: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function collectOperationIdRefsFromL4(
  specsDir: string,
  schemaDir: string,
): {
  refs: L4Ref[];
  l4Files: string[];
  errors: string[];
} {
  const L4_DIR = path.join(specsDir, 'L4.state');
  const l4Files = fs.existsSync(L4_DIR)
    ? fg.sync(['**/*.state.yaml'], { cwd: L4_DIR, absolute: true })
    : [];

  const refs: L4Ref[] = [];
  const errors: string[] = [];

  const validate = compileSchemaFromDir(schemaDir, 'L4.state.schema.json');

  for (const f of l4Files) {
    const raw = readYamlUnknown(f);

    const ok = validate(raw);
    if (!ok) {
      const details =
        validate.errors
          ?.map((e: any) => `${e.instancePath || '/'} ${e.message || ''}`.trim())
          .join(', ') ?? 'unknown error';
      errors.push(`🔴 L4 invalid: ${path.relative(specsDir, f)}: ${details}`);
      continue;
    }

    // ここから先は “スキーマに通った raw” として、必要箇所だけ安全に読む
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
        if (typeof operationId === 'string' && operationId.trim() !== '') {
          refs.push({ screenId, kind: 'query', name, operationId, file: f });
        }
      }
    }

    const mutations = data['mutations'];
    if (isRecord(mutations)) {
      for (const [name, m] of Object.entries(mutations)) {
        if (!isRecord(m)) continue;
        const operationId = m['operationId'];
        if (typeof operationId === 'string' && operationId.trim() !== '') {
          refs.push({ screenId, kind: 'mutation', name, operationId, file: f });
        }
      }
    }
  }

  return { refs, l4Files, errors };
}

export async function openapiCheck(opts: OpenapiCheckOptions): Promise<OpenapiCheckResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!fs.existsSync(opts.openapiPath)) {
    errors.push(`🔴 OpenAPI が見つかりません: ${opts.openapiPath}`);
    return { errors, warnings };
  }

  // ---- OpenAPI parse ----
  const openapiRaw = readYamlUnknown(opts.openapiPath);
  const openapiParsed = OpenApiSchema.safeParse(openapiRaw);
  if (!openapiParsed.success) {
    errors.push(`🔴 OpenAPI invalid: ${zodIssuesToText(openapiParsed.error.issues)}`);
    return { errors, warnings };
  }

  const { opIds, duplicates, missing } = collectOperationIdsFromOpenApi(openapiParsed.data);

  // ---- OpenAPI quality ----
  if (missing.length) {
    errors.push(`🔴 OpenAPI に operationId が無い operation: ${missing.join(', ')}`);
  }

  if (duplicates.size) {
    const lines = [...duplicates.entries()]
      .map(([id, where]) => `  - ${id}: ${where.join(', ')}`)
      .join('\n');
    errors.push(`🔴 OpenAPI operationId が重複（operationId は一意が必須）:\n${lines}`);
  }

  // ---- L4 refs (AJV) ----
  const {
    refs,
    l4Files,
    errors: l4Errors,
  } = collectOperationIdRefsFromL4(opts.specsDir, opts.schemaDir);
  errors.push(...l4Errors);

  if (l4Files.length === 0) {
    warnings.push('⚠️ L4.state が無いため、OpenAPI との突合をスキップしました');
    return { errors, warnings };
  }

  // ---- L4 -> OpenAPI ----
  for (const r of refs) {
    if (!opIds.has(r.operationId)) {
      errors.push(
        `🔴 L4 が存在しない operationId を参照: ${r.operationId} (${r.kind}:${r.name}) screen=${r.screenId} file=${path.relative(
          opts.specsDir,
          r.file,
        )}`,
      );
    }
  }

  // ---- OpenAPI -> L4 ----
  const used = new Set(refs.map((r) => r.operationId));
  const unused = [...opIds].filter((id) => !used.has(id));
  if (unused.length) {
    warnings.push(`⚠️ OpenAPI operationId が L4 から未参照（導入期ならOK）: ${unused.join(', ')}`);
  }

  return { errors, warnings };
}
