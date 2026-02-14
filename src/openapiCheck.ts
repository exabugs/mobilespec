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

// --------------------
// Zod schemas
// --------------------

// OpenAPI: operationId だけ取りたい。その他は無視（passthrough）
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

const OpenApiOperationSchema = z.looseObject({
  operationId: z.string().min(1).optional(),
});

const OpenApiPathItemSchema = z.record(z.string(), OpenApiOperationSchema);

const OpenApiSchema = z.looseObject({
  openapi: z.string().optional(),
  swagger: z.string().optional(),
  paths: z.record(z.string(), OpenApiPathItemSchema).optional(),
});

// L4: 混在なし方針 → selectRoot は存在してはいけない（strict）
const L4ApiCallSchema = z
  .object({
    operationId: z.string().min(1),
  })
  .strict();

const L4DocSchema = z
  .object({
    screen: z.object({
      id: z.string().min(1),
      data: z
        .object({
          queries: z.record(z.string(), L4ApiCallSchema).optional(),
          mutations: z.record(z.string(), L4ApiCallSchema).optional(),
        })
        .optional(),
    }),
  })
  .passthrough();

function readYamlUnknown(p: string): unknown {
  return yaml.load(fs.readFileSync(p, 'utf8'));
}

function formatZodIssues(prefix: string, issues: z.ZodIssue[]) {
  const body = issues.map((i) => `${i.path.join('/')}: ${i.message}`).join(', ');
  return `${prefix}: ${body}`;
}

type OpenApiDoc = z.infer<typeof OpenApiSchema>;
type OpenApiPathItem = z.infer<typeof OpenApiPathItemSchema>;
type OpenApiOperation = z.infer<typeof OpenApiOperationSchema>;

function collectOperationIdsFromOpenApi(doc: OpenApiDoc) {
  const opIds = new Set<string>();
  const missing: string[] = [];
  const occurrences = new Map<string, string[]>();

  const paths = doc.paths ?? {};
  for (const [p, pathItemAny] of Object.entries(paths)) {
    const pathItem = pathItemAny as OpenApiPathItem; // <- ここで型固定

    for (const [methodRaw, opAny] of Object.entries(pathItem)) {
      const m = methodRaw.toLowerCase();
      if (!HttpMethodSchema.safeParse(m).success) continue;

      const op = opAny as OpenApiOperation; // <- ここで型固定
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
  parseErrors: string[];
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
  const parseErrors: string[] = [];

  for (const f of l4Files) {
    const raw = readYamlUnknown(f);
    const parsed = L4DocSchema.safeParse(raw);
    if (!parsed.success) {
      parseErrors.push(
        `🔴 L4 parse error: ${path.relative(specsDir, f)}: ${formatZodIssues('invalid', parsed.error.issues)}`,
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

  return { refs, l4Files, parseErrors };
}

export async function openapiCheck(opts: OpenapiCheckOptions): Promise<OpenapiCheckResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!fs.existsSync(opts.openapiPath)) {
    errors.push(`🔴 OpenAPI が見つかりません: ${opts.openapiPath}`);
    return { errors, warnings };
  }

  // OpenAPI parse
  const openapiRaw = readYamlUnknown(opts.openapiPath);
  const openapiParsed = OpenApiSchema.safeParse(openapiRaw);
  if (!openapiParsed.success) {
    errors.push(
      `🔴 OpenAPI parse error: ${formatZodIssues('invalid', openapiParsed.error.issues)}`,
    );
    return { errors, warnings };
  }

  const { opIds, duplicates, missing } = collectOperationIdsFromOpenApi(openapiParsed.data);

  // OpenAPI quality
  if (missing.length) {
    errors.push(`🔴 OpenAPI に operationId が無い operation が存在します: ${missing.join(', ')}`);
  }

  if (duplicates.size) {
    const lines = [...duplicates.entries()]
      .map(([id, where]) => `  - ${id}: ${where.join(', ')}`)
      .join('\n');
    errors.push(
      `🔴 OpenAPI operationId が重複しています（operationId は一意である必要）:\n${lines}`,
    );
  }

  // L4 refs
  const { refs, l4Files, parseErrors } = collectOperationIdRefsFromL4(opts.specsDir);
  errors.push(...parseErrors);

  if (l4Files.length === 0) {
    warnings.push('⚠️ L4.state が無いため、OpenAPI との突合をスキップしました');
    return { errors, warnings };
  }

  // L4 -> OpenAPI
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

  // OpenAPI -> L4 (導入期は warning)
  const used = new Set(refs.map((r) => r.operationId));
  const unused = [...opIds].filter((id) => !used.has(id));
  if (unused.length) {
    warnings.push(
      `⚠️ OpenAPI の operationId が L4 から未参照です（導入途上ならOK）: ${unused.join(', ')}`,
    );
  }

  return { errors, warnings };
}
