// src/gen/order.ts — 生成物の並び順（決定的）: app.yaml の groups の順、グループ内は screenOrder、残りは ID 順
import { type Project, asArray } from '../core/model.js';

export function orderedScreenIds(project: Project): string[] {
  const groups = asArray(project.app?.data.groups).filter(
    (g): g is string => typeof g === 'string'
  );
  const order = asArray(project.app?.data.screenOrder).filter(
    (g): g is string => typeof g === 'string'
  );
  const ids = [...project.screens.keys()].filter((id) => project.screens.get(id)?.l2);
  const groupOf = (id: string): string => {
    const g = project.screens.get(id)?.l2?.data.group;
    return typeof g === 'string' ? g : '';
  };
  const rank = (id: string): number => {
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return ids.sort((a, b) => {
    const ga = groups.indexOf(groupOf(a));
    const gb = groups.indexOf(groupOf(b));
    const ra = ga === -1 ? Number.MAX_SAFE_INTEGER : ga;
    const rb = gb === -1 ? Number.MAX_SAFE_INTEGER : gb;
    if (ra !== rb) return ra - rb;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export function groupedScreenIds(project: Project): Array<{ group: string; ids: string[] }> {
  const out: Array<{ group: string; ids: string[] }> = [];
  for (const id of orderedScreenIds(project)) {
    const g = project.screens.get(id)?.l2?.data.group;
    const group = typeof g === 'string' ? g : '(なし)';
    const last = out[out.length - 1];
    if (last && last.group === group) last.ids.push(id);
    else out.push({ group, ids: [id] });
  }
  return out;
}
