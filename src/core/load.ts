// src/core/load.ts — プロジェクト（app.yaml と L2 / L3 / L4）の読み込み
import fg from 'fast-glob';
import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';

import type { Diagnostic } from './diagnostic.js';
import { type FileDoc, type Layer, type Project, type ScreenFiles, isObj } from './model.js';
import { LAYER_DIRS, SCREEN_ID } from './names.js';

export const APP_FILE = 'app.yaml';

type ParseOutcome = { ok: true; data: Record<string, unknown> } | { ok: false; diag: Diagnostic };

export function parseYamlFile(specsDir: string, rel: string): ParseOutcome {
  const abs = path.join(specsDir, rel);
  let text: string;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    return {
      ok: false,
      diag: {
        code: 'YAML_PARSE_ERROR',
        level: 'error',
        file: rel,
        message: `ファイルを読めません: ${(e as Error).message}`,
      },
    };
  }
  try {
    const data = yaml.load(text);
    if (data === undefined || data === null) return { ok: true, data: {} }; // 空のファイル
    if (!isObj(data)) {
      return {
        ok: false,
        diag: {
          code: 'YAML_PARSE_ERROR',
          level: 'error',
          file: rel,
          message: 'トップレベルがオブジェクトではありません',
        },
      };
    }
    return { ok: true, data };
  } catch (e) {
    const err = e as { message?: string; mark?: { line?: number } };
    const line = typeof err.mark?.line === 'number' ? err.mark.line + 1 : undefined;
    return {
      ok: false,
      diag: {
        code: 'YAML_PARSE_ERROR',
        level: 'error',
        file: rel,
        message: `YAML の構文エラー${line ? `（${line} 行目）` : ''}: ${String(err.message ?? e).split('\n')[0]}`,
        ...(line && { meta: { line } }),
      },
    };
  }
}

function layerFiles(specsDir: string, layer: Layer): string[] {
  const { dir, ext } = LAYER_DIRS[layer];
  const base = path.join(specsDir, dir);
  if (!fs.existsSync(base)) return [];
  return fg
    .sync([`**/*${ext}`], { cwd: base, dot: false })
    .map((f) => path.posix.join(dir, f))
    .sort();
}

export function loadProject(specsDir: string): Project {
  const diagnostics: Diagnostic[] = [];
  const screens = new Map<string, ScreenFiles>();

  // app.yaml
  let app: FileDoc | undefined;
  if (!fs.existsSync(path.join(specsDir, APP_FILE))) {
    diagnostics.push({
      code: 'APP_NOT_FOUND',
      level: 'error',
      file: APP_FILE,
      message: `${APP_FILE} がありません（アプリ全体の設定: version / groups / locales / openapi / facts）`,
    });
  } else {
    const r = parseYamlFile(specsDir, APP_FILE);
    if (r.ok) app = { file: APP_FILE, data: r.data };
    else diagnostics.push(r.diag);
  }

  // L2 / L3 / L4
  const key = { L2: 'l2', L3: 'l3', L4: 'l4' } as const;
  for (const layer of ['L2', 'L3', 'L4'] as const) {
    const { ext } = LAYER_DIRS[layer];
    for (const rel of layerFiles(specsDir, layer)) {
      const id = path.posix.basename(rel, ext);
      if (!SCREEN_ID.test(id)) {
        diagnostics.push({
          code: 'INVALID_FILE_ID',
          level: 'error',
          file: rel,
          found: id,
          message: `ファイル名 "${id}" が画面 ID として不正です（画面の ID はファイル名。小文字・数字・_ で、英字で始める）`,
        });
        continue;
      }
      const parsed = parseYamlFile(specsDir, rel);
      if (!parsed.ok) {
        diagnostics.push(parsed.diag);
        continue;
      }
      const entry = screens.get(id) ?? { id };
      const existing = entry[key[layer]];
      if (existing) {
        diagnostics.push({
          code: 'DUPLICATE_ID',
          level: 'error',
          file: rel,
          found: id,
          message: `画面 ID "${id}" が重複しています（${existing.file} と ${rel}）。画面の ID はファイル名で、レイヤー内で一意にします`,
        });
        continue;
      }
      entry[key[layer]] = { file: rel, data: parsed.data };
      screens.set(id, entry);
    }
  }

  const sorted = new Map([...screens.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return { specsDir, app, screens: sorted, diagnostics };
}
