// src/commands/update.ts — 生成物（ja.json、索引、遷移図）の更新と、最新かの検査（--check）
import path from 'node:path';

import { buildGraph } from '../core/derive.js';
import { expectedJa } from '../core/derive.js';
import { loadProject } from '../core/load.js';
import { type Project } from '../core/model.js';
import { generateArtifacts, readIfExists, writeFile } from '../gen/artifacts.js';
import { localesOf, readLocale } from '../rules/i18n.js';

export type UpdateResult =
  | { ok: true; written: string[]; stale: string[] }
  | { ok: false; message: string };

/** ja 以外の翻訳ファイル: 既存の翻訳を保ち、不足キーを空文字で足す */
function mergedLocale(project: Project, locale: string): string {
  const expected = [...expectedJa(project).keys()];
  const existing = readLocale(project.specsDir, locale) ?? {};
  const merged: Record<string, string> = { ...existing };
  for (const k of expected) if (!(k in merged)) merged[k] = '';
  const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => (a < b ? -1 : 1)));
  return JSON.stringify(sorted, null, 2) + '\n';
}

export function runUpdate(options: { specsDir: string; check?: boolean }): UpdateResult {
  const project = loadProject(options.specsDir);
  const fatal = project.diagnostics.find(
    (d) => d.code === 'YAML_PARSE_ERROR' || d.code === 'APP_NOT_FOUND'
  );
  if (fatal) {
    return {
      ok: false,
      message: `${fatal.file ?? ''}: ${fatal.message}（先に check で直してください）`,
    };
  }
  const edges = buildGraph(project);
  const artifacts = generateArtifacts(project, edges);

  const written: string[] = [];
  const stale: string[] = [];
  for (const [rel, content] of artifacts) {
    const current = readIfExists(path.join(options.specsDir, rel));
    if (current === content) continue;
    stale.push(rel);
    if (!options.check) {
      writeFile(options.specsDir, rel, content);
      written.push(rel);
    }
  }

  // ja 以外の翻訳（update だけが、不足キーを足す。--check では見ない: 翻訳の欠落は info）
  if (!options.check) {
    for (const locale of localesOf(project)) {
      if (locale === 'ja') continue;
      const rel = `i18n/${locale}.json`;
      const content = mergedLocale(project, locale);
      if (readIfExists(path.join(options.specsDir, rel)) !== content) {
        writeFile(options.specsDir, rel, content);
        written.push(rel);
      }
    }
  }
  return { ok: true, written, stale };
}
