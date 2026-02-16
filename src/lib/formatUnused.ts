// src/lib/formatUnused.ts

/**
 * 汎用: 構造情報（主に "METHOD /path"）から unused を分類・整形する。
 * - OpenAPI occurrences: ["GET /users", "POST /users"]
 * - その他: labels を持たない場合は "(unknown)" に入れる
 */

export type UnusedItem = {
  key: string; // operationId / transitionId / etc
  labels?: string[]; // e.g. ["GET /users/{id}", "POST /users"]
};

function extractRootFromLabel(label: string): string {
  // label: "GET /users/{id}" のような形式を想定（OpenAPI occurrences）
  const parts = label.split(' ');
  if (parts.length < 2) return '(unknown)';

  const p = parts[1] ?? '';
  const first = p.split('/').filter(Boolean)[0];
  return first ? `/${first}` : '/';
}

export function formatUnused(title: string, items: UnusedItem[]): string {
  if (items.length === 0) return title;

  const groups = new Map<string, UnusedItem[]>();

  for (const item of items) {
    let group = '(unknown)';

    const labels = item.labels?.filter((x) => typeof x === 'string' && x.trim() !== '') ?? [];
    if (labels.length) {
      const roots = new Set(labels.map(extractRootFromLabel));
      group = roots.size === 1 ? [...roots][0] : '(multiple roots)';
    }

    const arr = groups.get(group) ?? [];
    arr.push(item);
    groups.set(group, arr);
  }

  const body = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, entries]) => {
      const lines = entries
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((e) => {
          const labels = e.labels?.filter((x) => typeof x === 'string' && x.trim() !== '') ?? [];
          return labels.length ? `    - ${e.key} (${labels.join(', ')})` : `    - ${e.key}`;
        })
        .join('\n');

      return `  ${group}\n${lines}`;
    })
    .join('\n');

  return `${title}:\n${body}`;
}
