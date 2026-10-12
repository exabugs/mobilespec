// src/core/walk.ts — L3 の部品の木の走査（診断の場所を JSON ポインタで返す）
import { type Doc, asArray, isObj } from './model.js';

export type NodeVisit = { node: Doc; pointer: string };

function walkNode(node: unknown, pointer: string, out: NodeVisit[]): void {
  if (!isObj(node)) return;
  out.push({ node, pointer });
  asArray(node.children).forEach((c, i) => walkNode(c, `${pointer}/children/${i}`, out));
  if (isObj(node.layout)) {
    asArray(node.layout.children).forEach((c, i) =>
      walkNode(c, `${pointer}/layout/children/${i}`, out)
    );
  }
}

/** L3 の layout と headerRight の、すべての部品（親が先） */
export function l3Nodes(l3: Doc | undefined): NodeVisit[] {
  const out: NodeVisit[] = [];
  if (!l3) return out;
  if (isObj(l3.layout)) {
    asArray(l3.layout.children).forEach((c, i) => walkNode(c, `/layout/children/${i}`, out));
  }
  asArray(l3.headerRight).forEach((c, i) => walkNode(c, `/headerRight/${i}`, out));
  return out;
}
