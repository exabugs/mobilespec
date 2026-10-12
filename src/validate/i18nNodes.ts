// src/validate/i18nNodes.ts
//
// i18n の対象となる文言を持つ要素のうち、layout の外にあるもの（headerRight）と、
// メニュー項目（menu[]）を取り出す。キーは `${screenPrefix}.component.<id>.label`、元の文言は日本語。
//
// - node.name        … 部品の表示名（これまでどおり）
// - menu[].label     … メニュー項目の表示文言（menu[].id がキーになる）

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export type I18nEntry = { id: string; text: string };

/** 1 つのノードが持つメニュー項目の文言 */
export function menuLabelsOf(node: Record<string, unknown>): I18nEntry[] {
  const out: I18nEntry[] = [];
  if (!Array.isArray(node.menu)) return out;
  for (const item of node.menu) {
    if (!isObj(item)) continue;
    if (typeof item.id === 'string' && typeof item.label === 'string' && item.label.length > 0) {
      out.push({ id: item.id, text: item.label });
    }
  }
  return out;
}

/** headerRight の全ノード（子孫を含む）の、部品の表示名とメニュー項目の文言 */
export function headerRightEntries(screen: Record<string, unknown>): I18nEntry[] {
  const out: I18nEntry[] = [];
  if (!Array.isArray(screen.headerRight)) return out;

  const stack: unknown[] = [...screen.headerRight];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!isObj(node)) continue;

    if (typeof node.id === 'string' && typeof node.name === 'string' && node.name.length > 0) {
      out.push({ id: node.id, text: node.name });
    }
    out.push(...menuLabelsOf(node));

    if (Array.isArray(node.children)) stack.push(...node.children);
    if (isObj(node.layout) && Array.isArray(node.layout.children)) {
      stack.push(...node.layout.children);
    }
  }
  return out;
}
