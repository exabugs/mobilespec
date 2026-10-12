// src/validate.ts — 検証の入口（読み込み → スキーマ → 構造 → L2 / L3 / L4 → i18n → テキスト）
import path from 'node:path';

import { type SchemaName, validateAgainstSchema } from './core/ajv.js';
import { type Edge, buildGraph } from './core/derive.js';
import { type Diagnostic, type HasDiagnostics } from './core/diagnostic.js';
import { loadProject } from './core/load.js';
import { type Project, asObj } from './core/model.js';
import { type OpenApiIndex, loadOpenApi } from './core/openapi.js';
import { checkI18n } from './rules/i18n.js';
import { checkL2 } from './rules/l2.js';
import { checkL3 } from './rules/l3.js';
import { checkL4 } from './rules/l4.js';
import { factNames } from './rules/scope.js';
import { checkStructure } from './rules/structure.js';
import { checkText } from './rules/text.js';

export type ValidateOptions = {
  specsDir: string;
  /** スキーマのディレクトリ（既定はパッケージ同梱） */
  schemaDir?: string;
  /** OpenAPI のパス（絶対パス）。無ければ app.yaml の openapi */
  openapiPath?: string;
  /** 指定した画面の診断だけを返す（修正ループを速くする） */
  screen?: string;
};

export type ValidationResult = HasDiagnostics & {
  project: Project;
  edges: Edge[];
  openapi?: OpenApiIndex;
};

function usesData(project: Project): boolean {
  for (const s of project.screens.values()) {
    const data = asObj(s.l4?.data.data);
    if (Object.keys(asObj(data.queries)).length + Object.keys(asObj(data.mutations)).length > 0)
      return true;
  }
  return false;
}

export function validate(options: ValidateOptions): ValidationResult {
  const project = loadProject(options.specsDir);
  const diagnostics: Diagnostic[] = [...project.diagnostics];
  const schemaDir = options.schemaDir;

  // スキーマ
  const schemaCheck = (doc: { file: string; data: unknown } | undefined, name: SchemaName) => {
    if (doc) diagnostics.push(...validateAgainstSchema(doc.data, doc.file, name, schemaDir));
  };
  schemaCheck(project.app, 'app');
  for (const s of project.screens.values()) {
    schemaCheck(s.l2, 'L2');
    schemaCheck(s.l3, 'L3');
    schemaCheck(s.l4, 'L4');
  }

  // OpenAPI
  let openapi: OpenApiIndex | undefined;
  const raw = project.app?.data.openapi;
  const openapiPath =
    options.openapiPath ??
    (typeof raw === 'string' && raw.trim() !== ''
      ? path.resolve(options.specsDir, raw)
      : undefined);
  if (openapiPath) {
    const r = loadOpenApi(openapiPath);
    if (r.ok) openapi = r.index;
    else {
      diagnostics.push({
        code: /読めません/.test(r.message) ? 'OPENAPI_NOT_FOUND' : 'OPENAPI_INVALID',
        level: 'error',
        file: 'app.yaml',
        pointer: '/openapi',
        message: `${r.message}（${openapiPath}）`,
      });
    }
  } else if (project.app && usesData(project)) {
    diagnostics.push({
      code: 'OPENAPI_NOT_FOUND',
      level: 'error',
      file: 'app.yaml',
      pointer: '/openapi',
      message:
        'L4 の data（operationId）を使うには、app.yaml の openapi（OpenAPI のパス）が必要です',
    });
  }

  const edges = buildGraph(project);
  const usedBy = new Map<string, Set<string>>();
  for (const id of project.screens.keys()) usedBy.set(id, new Set());

  diagnostics.push(...checkStructure(project));
  diagnostics.push(...checkL2(project, edges, usedBy));
  diagnostics.push(...checkL3(project, usedBy));
  diagnostics.push(...checkL4(project, openapi, usedBy));
  diagnostics.push(...checkI18n(project));
  diagnostics.push(...checkText(project));

  // 未使用の fact（どの画面からも参照されていない）
  const allUsed = new Set<string>();
  for (const u of usedBy.values()) for (const n of u) allUsed.add(n);
  for (const f of factNames(project)) {
    if (!allUsed.has(f)) {
      diagnostics.push({
        code: 'UNUSED_DEFINITION',
        level: 'info',
        file: 'app.yaml',
        pointer: `/facts/${f}`,
        found: f,
        message: `fact "${f}" はどの画面からも参照されていません`,
      });
    }
  }

  // 画面の絞り込み
  let result = diagnostics;
  if (options.screen) {
    const s = project.screens.get(options.screen);
    if (!s) {
      result = [
        ...diagnostics,
        {
          code: 'SCREEN_NOT_FOUND',
          level: 'error',
          message: `画面 "${options.screen}" がありません（${[...project.screens.keys()].join(', ')}）`,
          found: options.screen,
        } as Diagnostic,
      ];
    } else {
      // 他の画面のファイルの診断だけを除く（app.yaml・生成物・全体の診断は常に残す）
      const others = new Set<string>();
      for (const [id, o] of project.screens) {
        if (id === options.screen) continue;
        for (const f of [o.l2?.file, o.l3?.file, o.l4?.file]) if (f) others.add(f);
      }
      result = diagnostics.filter((d) => d.file === undefined || !others.has(d.file));
    }
  }

  return { project, edges, openapi, diagnostics: dedupe(result) };
}

/** 同じ場所・同じ内容の診断を 1 件にまとめる */
function dedupe(list: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return list.filter((d) => {
    const key = `${d.code}\u0000${d.file ?? ''}\u0000${d.pointer ?? ''}\u0000${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
