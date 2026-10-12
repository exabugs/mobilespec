// src/commands/new.ts — 最小の有効な画面ファイル（L2 / L3 / L4）を作る（書式を暗記しなくてよい）
import fs from 'node:fs';
import path from 'node:path';

import { loadProject } from '../core/load.js';
import { asArray } from '../core/model.js';
import { LAYER_DIRS, SCREEN_ID } from '../core/names.js';

export type NewResult = { ok: true; files: string[] } | { ok: false; message: string };

export function runNew(options: {
  specsDir: string;
  id: string;
  group: string;
  name?: string;
}): NewResult {
  const { specsDir, id, group } = options;
  if (!SCREEN_ID.test(id)) {
    return { ok: false, message: `画面 ID "${id}" が不正です（小文字・数字・_ で、英字で始める）` };
  }
  const project = loadProject(specsDir);
  const groups = asArray(project.app?.data.groups).filter(
    (g): g is string => typeof g === 'string'
  );
  if (!project.app) return { ok: false, message: 'app.yaml がありません' };
  if (!groups.includes(group)) {
    return {
      ok: false,
      message: `グループ "${group}" が app.yaml の groups にありません（${groups.join(', ')}）`,
    };
  }
  if (project.screens.has(id)) {
    return { ok: false, message: `画面 "${id}" は既にあります` };
  }
  const files: Array<[string, string]> = [
    [
      `${LAYER_DIRS.L2.dir}/${group}/${id}${LAYER_DIRS.L2.ext}`,
      `name: ${options.name ?? id}\ngroup: ${group}\n# summary: 1 行の要約（一覧・索引に出る）\n# description: 人向けの説明（ドキュメント用）\ntransitions: []\n`,
    ],
    [`${LAYER_DIRS.L3.dir}/${id}${LAYER_DIRS.L3.ext}`, `layout:\n  type: column\n  children: []\n`],
    [`${LAYER_DIRS.L4.dir}/${id}${LAYER_DIRS.L4.ext}`, `events: {}\n`],
  ];
  for (const [rel] of files) {
    if (fs.existsSync(path.join(specsDir, rel)))
      return { ok: false, message: `${rel} は既にあります` };
  }
  for (const [rel, content] of files) {
    fs.mkdirSync(path.dirname(path.join(specsDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(specsDir, rel), content, 'utf8');
  }
  return { ok: true, files: files.map(([rel]) => rel) };
}
