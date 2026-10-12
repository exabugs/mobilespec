// src/gen/artifacts.ts — 生成物（ja.json、索引、遷移図）。update が書き、update --check が突き合わせる
import fs from 'node:fs';
import path from 'node:path';

import { expectedJa } from '../core/derive.js';
import { type Edge } from '../core/derive.js';
import { type Project } from '../core/model.js';
import { renderFlowchart } from './flows.js';
import { renderIndex } from './index.js';

export const GENERATED_DIR = '.mobilespec';

/** 生成物（相対パス → 内容）。ja のほかの翻訳は、手で保守するもの（update は不足キーを空で足すだけ） */
export function generateArtifacts(project: Project, edges: Edge[]): Map<string, string> {
  const out = new Map<string, string>();
  out.set('i18n/ja.json', JSON.stringify(Object.fromEntries(expectedJa(project)), null, 2) + '\n');
  out.set(`${GENERATED_DIR}/index.md`, renderIndex(project, edges));
  out.set(
    `${GENERATED_DIR}/flows.md`,
    `# 遷移図\n\n> 生成物です。手で編集しないでください（\`mobilespec update\` で再生成します）。\n\n\`\`\`mermaid\n${renderFlowchart(project, edges)}\n\`\`\`\n`
  );
  return out;
}

export function readIfExists(file: string): string | undefined {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
}

export function writeFile(specsDir: string, rel: string, content: string): void {
  const file = path.join(specsDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}
