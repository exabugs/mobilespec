// src/gen/index.ts — 全体の索引（生成物）。AI が最初に読む 1 枚。画面ファイルを開かずに全体像を掴む
import type { Edge } from '../core/derive.js';
import { type Project, asObj, isObj } from '../core/model.js';
import { EXTERNAL_TARGET } from '../core/names.js';
import { groupedScreenIds } from './order.js';

export function operationsOf(project: Project, id: string): string[] {
  const data = asObj(project.screens.get(id)?.l4?.data.data);
  const ops: string[] = [];
  for (const kind of ['queries', 'mutations'] as const) {
    for (const def of Object.values(asObj(data[kind]))) {
      if (isObj(def) && typeof def.operationId === 'string') ops.push(def.operationId);
    }
  }
  return [...new Set(ops)];
}

const cell = (s: unknown): string =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');

export function renderIndex(project: Project, edges: Edge[]): string {
  const out: string[] = [];
  const total = [...project.screens.values()].filter((s) => s.l2).length;
  const ops = new Map<string, string[]>();
  for (const id of project.screens.keys()) {
    for (const op of operationsOf(project, id)) ops.set(op, [...(ops.get(op) ?? []), id]);
  }
  out.push('# 画面の索引');
  out.push('');
  out.push('> 生成物です。手で編集しないでください（`mobilespec update` で再生成します）。');
  out.push('');
  out.push(`画面 ${total} / 遷移 ${edges.length} / 使う API ${ops.size}`);
  out.push('');
  out.push('## 画面');
  for (const { group, ids } of groupedScreenIds(project)) {
    out.push('');
    out.push(`### ${group}`);
    out.push('');
    out.push('| id | 名前 | 起点 | 遷移先 | 使う API | 概要 |');
    out.push('| --- | --- | --- | --- | --- | --- |');
    for (const id of ids) {
      const l2 = asObj(project.screens.get(id)?.l2?.data);
      const flag = l2.entry === true ? 'entry' : l2.root === true ? 'root' : '';
      const to = [...new Set(edges.filter((e) => e.from === id).map((e) => e.to))];
      out.push(
        `| ${id} | ${cell(l2.name)} | ${flag} | ${cell(to.join(', '))} | ${cell(operationsOf(project, id).join(', '))} | ${cell(l2.summary)} |`
      );
    }
  }
  out.push('');
  out.push('## 遷移');
  out.push('');
  out.push('```text');
  for (const e of edges) {
    const params = Object.keys(e.params);
    const kind = e.auto ? (e.else ? ' [auto, else]' : ` [auto: ${e.when ?? ''}]`) : '';
    const step = e.step !== undefined ? ` (stack ${e.step}: ${e.stackKind})` : '';
    out.push(
      `${e.from} --${e.id}--> ${e.to}${params.length ? ` {${params.join(', ')}}` : ''}${kind}${step}`
    );
  }
  out.push('```');
  if (edges.some((e) => e.to === EXTERNAL_TARGET)) {
    out.push('');
    out.push('`external` はアプリ外・SDK 管理の遷移先です。');
  }
  out.push('');
  out.push('## API の使用');
  out.push('');
  if (ops.size === 0) {
    out.push('（なし）');
  } else {
    out.push('| operationId | 使う画面 |');
    out.push('| --- | --- |');
    for (const [op, screens] of [...ops.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      out.push(`| ${op} | ${screens.join(', ')} |`);
    }
  }
  out.push('');
  return out.join('\n');
}
