// src/openapiCheck.ts
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import yaml from 'js-yaml';
import { z } from 'zod';

export type OpenapiCheckOptions = {
  specsDir: string;
  schemaDir: string; // 未使用（将来拡張用）
  openapiPath: string;
};

export type OpenapiCheckResult = {
  errors: string[];
  warnings: string[];
};

// ------------------------------------
// Zod schemas (v4)
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

// L4: 混在禁止 → selectRoot を書かせない（strictObject）
const L4ApiCallSchema = z.strictObject({
  operationId: z.string().min(1),
});

const L4DocSchema = z.looseObject({
  screen: z.looseObject({
    id: z.string().min(1),
    data: z
      .looseObject({
        queries: z.record(z.string(), L4ApiCallSchema).optional(),
        mutations: z.record(z.string(), L4ApiCallSchema).optional(),
      })
      .optional(),
  }),
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

  // ここは parse済みの型なので unknown になりません
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

function collectOperationIdRefsFromL4(specsDir: string): {
  refs: Array<{
    screenId: string;
    kind: 'query' | 'mutation';
    name: string;
    operationId: string;
    file: string;
  }>;
  l4Files: string[];
  errors: string[];
} {
  const L4_DIR = path.join(specsDir, 'L4.state');
  const l4Files = fs.existsSync(L4_DIR)
    ? fg.sync(['**/*.state.yaml'], { cwd: L4_DIR, absolute: true })
    : [];

  const refs: Array<{
    screenId: string;
    kind: 'query' | 'mutation';
    name: string;
    operationId: string;
    file: string;
  }> = [];
  const errors: string[] = [];

  for (const f of l4Files) {
    const raw = readYamlUnknown(f);
    const parsed = L4DocSchema.safeParse(raw);

    if (!parsed.success) {
      errors.push(
        `🔴 L4 invalid: ${path.relative(specsDir, f)}: ${zodIssuesToText(parsed.error.issues)}`,
      );
      continue;
    }

    const doc = parsed.data;
    const screenId = doc.screen.id;

    const queries = doc.screen.data?.queries ?? {};
    for (const [name, q] of Object.entries(queries)) {
      refs.push({ screenId, kind: 'query', name, operationId: q.operationId, file: f });
    }

    const mutations = doc.screen.data?.mutations ?? {};
    for (const [name, m] of Object.entries(mutations)) {
      refs.push({ screenId, kind: 'mutation', name, operationId: m.operationId, file: f });
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

  // ---- L4 refs ----
  const { refs, l4Files, errors: l4Errors } = collectOperationIdRefsFromL4(opts.specsDir);
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
