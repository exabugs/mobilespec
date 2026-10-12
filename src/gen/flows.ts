// src/gen/flows.ts — 遷移図（Mermaid）。L2 だけから導く
import type { Edge } from '../core/derive.js';
import { type Project, asObj } from '../core/model.js';
import { EXTERNAL_TARGET } from '../core/names.js';
import { groupedScreenIds } from './order.js';

const esc = (s: string): string => s.replace(/"/g, '&quot;').replace(/\n/g, ' ');

/** 画面 1 つを中心にした遷移図（その画面への遷移と、その画面からの遷移）。edges は全体 */
export function renderFlowchart(project: Project, edges: Edge[], only?: string): string {
  const lines: string[] = ['flowchart LR'];
  const visible = (e: Edge) => !only || e.from === only || e.to === only;
  const shown = edges.filter(visible);
  const ids = new Set<string>();
  if (only) {
    ids.add(only);
    for (const e of shown) {
      ids.add(e.from);
      if (e.to !== EXTERNAL_TARGET) ids.add(e.to);
    }
  }
  for (const { group, ids: groupIds } of groupedScreenIds(project)) {
    const members = groupIds.filter((id) => !only || ids.has(id));
    if (members.length === 0) continue;
    lines.push(`  subgraph ${group}["${esc(group)}"]`);
    for (const id of members) {
      const l2 = asObj(project.screens.get(id)?.l2?.data);
      const mark = l2.entry === true ? ' ⭐' : l2.root === true ? ' ◎' : '';
      lines.push(`    ${id}["${id}${mark}<br/>${esc(String(l2.name ?? ''))}"]`);
    }
    lines.push('  end');
  }
  if (shown.some((e) => e.to === EXTERNAL_TARGET))
    lines.push(`  ${EXTERNAL_TARGET}(("${EXTERNAL_TARGET}"))`);
  for (const e of shown) {
    const label = e.auto
      ? `${e.id} (auto${e.else ? ', else' : e.when ? `: ${e.when}` : ''})`
      : e.id;
    const arrow = e.auto ? '-.->' : '-->';
    lines.push(`  ${e.from} ${arrow}|"${esc(label)}"| ${e.to}`);
  }
  return lines.join('\n');
}
