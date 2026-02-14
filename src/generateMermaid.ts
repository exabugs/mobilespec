/**
 * Mermaid Diagram Generator
 * Generates Mermaid flowchart from L2 screenflows
 */

import fs from "fs";
import path from "path";
import {
  validate,
  type Screen,
  type Transition,
  type ValidateOptions,
} from "./validate.js";

/* ================================
 * Helpers
 * ================================ */

function removeTypePrefix(id: string): string {
  const words = id.split("_");
  // タイププレフィックス除去（先頭の1要素）
  return words.length > 1 ? words.slice(1).join("_") : id;
}

function displayId(id: string, context?: string): string {
  const cleanId = removeTypePrefix(id);
  return context ? `${cleanId}[${context}]` : cleanId;
}

function mermaidId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

/* ================================
 * Generate Mermaid
 * ================================ */

// グループ階層を表現する型
type GroupHierarchy = {
  name: string;
  fullPath: string;
  screens: Array<{ key: string; screen: Screen }>;
  children: Map<string, GroupHierarchy>;
};

function buildGroupHierarchy(screens: Map<string, Screen>): GroupHierarchy {
  const root: GroupHierarchy = {
    name: "",
    fullPath: "",
    screens: [],
    children: new Map(),
  };

  for (const [key, screen] of screens.entries()) {
    if (!screen.group) {
      // グループなし（ルート直下）
      root.screens.push({ key, screen });
      continue;
    }

    // グループパスを分割（例: 'Venue/Nearby' → ['Venue', 'Nearby']）
    const parts = screen.group.split("/");
    let current = root;

    // 階層を辿りながらノードを作成
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const fullPath = parts.slice(0, i + 1).join("/");

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullPath,
          screens: [],
          children: new Map(),
        });
      }
      current = current.children.get(part)!;
    }

    // 最終階層にスクリーンを追加
    current.screens.push({ key, screen });
  }

  return root;
}

function renderGroupHierarchy(
  node: GroupHierarchy,
  indent: string,
  groupOrderMap: Map<string, number>,
): string[] {
  const lines: string[] = [];

  // 子グループをソート
  const sortedChildren = Array.from(node.children.entries()).sort(
    ([, a], [, b]) => {
      const orderA = groupOrderMap.get(a.fullPath) ?? 99;
      const orderB = groupOrderMap.get(b.fullPath) ?? 99;
      return orderA - orderB;
    },
  );

  // スクリーンをソート
  const sortedScreens = [...node.screens].sort(
    (a, b) => (a.screen.order ?? 0) - (b.screen.order ?? 0),
  );

  // スクリーンをレンダリング
  for (const { key, screen } of sortedScreens) {
    const nodeId = mermaidId(key);
    const idLabel = displayId(screen.id, screen.context);
    lines.push(`${indent}${nodeId}["${screen.name}<br/>${idLabel}"]`);
  }

  // 子グループをレンダリング（入れ子のサブグラフ）
  for (const [childName, child] of sortedChildren) {
    lines.push(`${indent}subgraph ${childName}`);
    lines.push(...renderGroupHierarchy(child, indent + "  ", groupOrderMap));
    lines.push(`${indent}end`);
  }

  return lines;
}

function generateMermaidContent(
  screens: Map<string, Screen>,
  transitions: Transition[],
  groupOrder: string[],
): string {
  const lines: string[] = [];

  lines.push("```mermaid");
  lines.push("flowchart LR");
  lines.push("");

  /* ---- Entry / Exit styles ---- */
  const entryIds: string[] = [];
  const exitIds: string[] = [];

  for (const [key, s] of screens.entries()) {
    const mid = mermaidId(key);
    if (s.entry) entryIds.push(mid);
    if (s.exit) exitIds.push(mid);
  }

  if (entryIds.length || exitIds.length) {
    lines.push("%% --- Entry / Exit styles ---");
    lines.push("classDef entry stroke:#2196f3,stroke-width:2px;");
    lines.push("classDef exit stroke:#c62828,stroke-width:2px;");
    lines.push("");
  }

  /* ---- build group hierarchy ---- */
  const hierarchy = buildGroupHierarchy(screens);

  /* ---- create group order map ---- */
  const groupOrderMap = new Map<string, number>();
  groupOrder.forEach((group, index) => {
    groupOrderMap.set(group, index);
  });

  /* ---- render hierarchy ---- */
  lines.push(...renderGroupHierarchy(hierarchy, "", groupOrderMap));
  lines.push("");

  /* ---- edges (self-loop emphasized) ---- */
  for (const t of transitions) {
    if (!screens.has(t.fromKey) || !screens.has(t.toKey)) continue;

    const fromId = mermaidId(t.fromKey);
    const toId = mermaidId(t.toKey);
    const arrow = t.self ? "-.->" : "-->";
    const cleanLabel = t.label ? removeTypePrefix(t.label) : "";

    lines.push(`  ${fromId} ${arrow}|${cleanLabel}| ${toId}`);
  }

  /* ---- apply classes ---- */
  if (entryIds.length) {
    lines.push("");
    for (const id of entryIds.sort()) lines.push(`class ${id} entry;`);
  }
  if (exitIds.length) {
    lines.push("");
    for (const id of exitIds.sort()) lines.push(`class ${id} exit;`);
  }

  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

/* ================================
 * Public API
 * ================================ */

export async function generateMermaid(options: ValidateOptions): Promise<void> {
  const outputFile = path.join(options.specsDir, "flows.md");

  // バリデーション実行
  const result = validate(options);

  // エラーがあれば終了
  if (result.errors.length > 0) {
    console.error(
      "\n🔴 バリデーションエラーがあるため、Mermaid図生成を中断します",
    );
    process.exit(1);
  }

  // 警告表示
  if (result.warnings.length > 0) {
    console.warn("\n⚠️  バリデーション警告:");
    for (const warn of result.warnings) {
      console.warn(`  ${warn}`);
    }
  }

  // Mermaid図生成
  const mermaidContent = generateMermaidContent(
    result.screens,
    result.transitions,
    result.config.mermaid.groupOrder,
  );

  fs.writeFileSync(outputFile, mermaidContent, "utf-8");
  console.log(`\n✅ Mermaid 図を生成しました: ${path.resolve(outputFile)}`);
  console.log(`   screens: ${result.screens.size}`);
  console.log(`   transitions: ${result.transitions.length}`);
  console.log(`   ui actions: ${result.uiActions.length}`);
}
