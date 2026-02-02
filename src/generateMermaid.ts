/**
 * Mermaid Diagram Generator
 * Generates Mermaid flowchart from L2 screenflows
 */

import fs from 'fs';
import path from 'path';
import { validate, type Screen, type Transition, type ValidateOptions } from './validate.js';

/* ================================
 * Helpers
 * ================================ */

function removeTypePrefix(id: string): string {
  const words = id.split('_');
  // タイププレフィックス除去（先頭の1要素）
  return words.length > 1 ? words.slice(1).join('_') : id;
}

function displayId(id: string, context?: string): string {
  const cleanId = removeTypePrefix(id);
  return context ? `${cleanId}[${context}]` : cleanId;
}

function mermaidId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, '_');
}

/* ================================
 * Generate Mermaid
 * ================================ */

function generateMermaidContent(
  screens: Map<string, Screen>,
  transitions: Transition[],
  groupOrder: string[]
): string {
  const lines: string[] = [];

  lines.push('```mermaid');
  lines.push('flowchart LR');
  lines.push('');

  /* ---- Entry / Exit styles ---- */
  const entryIds: string[] = [];
  const exitIds: string[] = [];

  for (const [key, s] of screens.entries()) {
    const mid = mermaidId(key);
    if (s.entry) entryIds.push(mid);
    if (s.exit) exitIds.push(mid);
  }

  if (entryIds.length || exitIds.length) {
    lines.push('%% --- Entry / Exit styles ---');
    lines.push('classDef entry fill:#e3f2fd,stroke:#2196f3,stroke-width:2px;');
    lines.push('classDef exit fill:#ffebee,stroke:#c62828,stroke-width:2px;');
    lines.push('');
  }

  /* ---- collect groups ---- */
  const groups = new Map<string, Array<{ key: string; screen: Screen }>>();

  for (const [key, s] of screens.entries()) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group)!.push({ key, screen: s });
  }

  /* ---- sort groups ---- */
  const groupOrderMap = new Map<string, number>();
  groupOrder.forEach((group, index) => {
    groupOrderMap.set(group, index);
  });

  const sortedGroups = Array.from(groups.entries()).sort(
    ([a], [b]) => (groupOrderMap.get(a) ?? 99) - (groupOrderMap.get(b) ?? 99)
  );

  /* ---- sort screens in group (order asc) ---- */
  for (const [, groupScreens] of sortedGroups) {
    groupScreens.sort((a, b) => (a.screen.order ?? 0) - (b.screen.order ?? 0));
  }

  /* ---- render subgraphs ---- */
  for (const [group, groupScreens] of sortedGroups) {
    lines.push(`subgraph ${group}`);

    for (const { key, screen } of groupScreens) {
      const nodeId = mermaidId(key);
      const idLabel = displayId(screen.id, screen.context);

      lines.push(`  ${nodeId}["${screen.name}<br/>${idLabel}"]`);
    }

    lines.push('end');
    lines.push('');
  }

  /* ---- edges (self-loop emphasized) ---- */
  for (const t of transitions) {
    if (!screens.has(t.fromKey) || !screens.has(t.toKey)) continue;

    const fromId = mermaidId(t.fromKey);
    const toId = mermaidId(t.toKey);
    const arrow = t.self ? '-.->' : '-->';
    const cleanLabel = t.label ? removeTypePrefix(t.label) : '';

    lines.push(`  ${fromId} ${arrow}|${cleanLabel}| ${toId}`);
  }

  /* ---- apply classes ---- */
  if (entryIds.length) {
    lines.push('');
    for (const id of entryIds.sort()) lines.push(`class ${id} entry;`);
  }
  if (exitIds.length) {
    lines.push('');
    for (const id of exitIds.sort()) lines.push(`class ${id} exit;`);
  }

  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

/* ================================
 * Public API
 * ================================ */

export async function generateMermaid(options: ValidateOptions): Promise<void> {
  const outputFile = path.join(options.specsDir, 'flows.md');
  
  // バリデーション実行
  const result = validate(options);

  // エラーがあれば終了
  if (result.errors.length > 0) {
    console.error('\n🔴 バリデーションエラーがあるため、Mermaid図生成を中断します');
    process.exit(1);
  }

  // 警告表示
  if (result.warnings.length > 0) {
    console.warn('\n⚠️  バリデーション警告:');
    for (const warn of result.warnings) {
      console.warn(`  ${warn}`);
    }
  }

  // Mermaid図生成
  const mermaidContent = generateMermaidContent(
    result.screens,
    result.transitions,
    result.config.mermaid.groupOrder
  );

  fs.writeFileSync(outputFile, mermaidContent, 'utf-8');
  console.log(`\n✅ Mermaid 図を生成しました: ${path.resolve(outputFile)}`);
  console.log(`   screens: ${result.screens.size}`);
  console.log(`   transitions: ${result.transitions.length}`);
  console.log(`   ui actions: ${result.uiActions.length}`);
}
