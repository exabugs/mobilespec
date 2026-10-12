// src/commands/docs.ts — 人間向けドキュメント（Markdown + Mermaid）と、機械可読の全体モデル（JSON）
import fs from 'node:fs';
import path from 'node:path';

import type { Edge } from '../core/derive.js';
import { type Project, asArray, asObj, isObj } from '../core/model.js';
import type { OpenApiIndex } from '../core/openapi.js';
import { renderFlowchart } from '../gen/flows.js';
import { groupedScreenIds } from '../gen/order.js';
import { type ContextModel, buildContext } from './context.js';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** 画面 1 つぶんの Markdown（散文を含む。AI 向けの context とは別で、人が読む） */
function renderScreen(project: Project, m: ContextModel, edges: Edge[], only: string): string {
  const s = project.screens.get(m.screen)!;
  const l2 = asObj(s.l2?.data);
  const out: string[] = [`# ${m.screen} — ${m.name}`, ''];
  const meta = [
    str(l2.status) && `状態: ${str(l2.status)}`,
    `グループ: ${str(l2.group)}`,
    l2.entry === true && '起点',
    l2.root === true && 'ルート',
  ].filter(Boolean);
  out.push(meta.join(' / '), '');
  if (str(l2.summary)) out.push(str(l2.summary), '');
  if (str(l2.description)) out.push(str(l2.description), '');
  const notes = asArray(l2.notes).filter((n): n is string => typeof n === 'string');
  if (notes.length > 0) out.push('## 注意', '', ...notes.map((n) => `- ${n}`), '');

  out.push('## 遷移', '', '```mermaid', renderFlowchart(project, edges, only), '```', '');
  const trs = asArray(l2.transitions).filter(isObj);
  if (trs.length > 0) {
    out.push('| 遷移 | 行き先 | 条件 | 説明 |', '| --- | --- | --- | --- |');
    for (const t of trs) {
      const target = str(t.target) || (t.stack ? '（stack）' : '');
      const cond = t.else === true ? 'else' : str(t.when);
      out.push(
        `| ${cell(str(t.id))}${t.auto === true ? '（auto）' : ''} | ${cell(target)} | ${cell(cond)} | ${cell(str(t.description))} |`
      );
    }
    out.push('');
  }
  const params = asArray(l2.params).filter(isObj);
  if (params.length > 0) {
    out.push('## パラメータ', '', '| 名前 | 型 | 必須 | 説明 |', '| --- | --- | --- | --- |');
    for (const p of params) {
      out.push(
        `| ${cell(str(p.name))} | ${cell(typeof p.type === 'string' ? p.type : JSON.stringify(p.type))} | ${p.required === true ? '○' : ''} | ${cell(str(p.description))} |`
      );
    }
    out.push('');
  }
  if (m.operations.length > 0) {
    out.push('## 使う API', '');
    for (const o of m.operations) {
      out.push(
        `- \`${o.operationId}\`${o.summary ? ` — ${o.summary}` : ''}${o.response ? `（応答: ${o.response}）` : ''}`
      );
    }
    out.push('');
  }
  if (m.facts.length > 0) {
    out.push('## 参照する前提（facts）', '');
    for (const f of m.facts)
      out.push(`- \`${f.name}\`${f.description ? ` — ${f.description}` : ''}`);
    out.push('');
  }
  const l4 = asObj(s.l4?.data);
  const conds = Object.entries(asObj(l4.conditions));
  if (conds.length > 0) {
    out.push('## 条件', '', '| 名前 | 式 | 説明 |', '| --- | --- | --- |');
    for (const [k, v] of conds) {
      const c = asObj(v);
      out.push(`| ${cell(k)} | ${cell(str(c.expr))} | ${cell(str(c.description))} |`);
    }
    out.push('');
  }
  const evs = Object.entries(asObj(l4.events));
  if (evs.length > 0) {
    out.push('## イベント', '', '| 名前 | きっかけ | 説明 |', '| --- | --- | --- |');
    for (const [k, v] of evs) {
      const e = asObj(v);
      out.push(`| ${cell(k)} | ${cell(str(e.on) || 'ui')} | ${cell(str(e.description))} |`);
    }
    out.push('');
  }
  if (Object.keys(m.ja).length > 0) {
    out.push('## 画面の文言（ja）', '');
    for (const [k, v] of Object.entries(m.ja)) out.push(`- \`${k}\`: ${v}`);
    out.push('');
  }
  return out.join('\n');
}

export function renderDocs(
  project: Project,
  edges: Edge[],
  openapi: OpenApiIndex | undefined
): Map<string, string> {
  const files = new Map<string, string>();
  const index: string[] = [
    '# 画面仕様',
    '',
    '> 生成物です。編集するのは `L2` / `L3` / `L4` の仕様ファイルです。',
    '',
  ];
  index.push('## 全体の遷移', '', '```mermaid', renderFlowchart(project, edges), '```', '');
  for (const { group, ids } of groupedScreenIds(project)) {
    index.push(`## ${group}`, '');
    for (const id of ids) {
      const m = buildContext(project, edges, openapi, id, { docs: true });
      if (!m) continue;
      files.set(`screens/${id}.md`, renderScreen(project, m, edges, id));
      const summary = str(asObj(project.screens.get(id)?.l2?.data).summary);
      index.push(`- [${id}](screens/${id}.md) — ${m.name}${summary ? `: ${summary}` : ''}`);
    }
    index.push('');
  }
  files.set('index.md', index.join('\n'));
  return files;
}

/** 全体の機械可読モデル（画面ごとの context をまとめたもの） */
export function exportModel(
  project: Project,
  edges: Edge[],
  openapi: OpenApiIndex | undefined
): unknown {
  const screens = [...project.screens.keys()]
    .map((id) => buildContext(project, edges, openapi, id, { docs: true }))
    .filter((m): m is ContextModel => m !== undefined);
  return {
    version: 2,
    facts: asObj(project.app?.data.facts),
    screens,
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      transition: e.id,
      auto: e.auto,
      params: Object.keys(e.params),
    })),
  };
}

export function writeDocs(outDir: string, files: Map<string, string>): string[] {
  const written: string[] = [];
  for (const [rel, content] of files) {
    const abs = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    written.push(rel);
  }
  return written;
}
