// src/core/derive.ts
//
// 手で書かないもの（S2）を、仕様から導く。
// - 遷移グラフ: L2 だけから（L4 は接続を持たない）
// - 遷移の起動のしかた: L3 の action / L4 の go の参照から
// - ja の文言: 画面の name、部品の name、メニュー項目の label から
import { type Doc, type Project, asArray, asObj, isObj } from './model.js';
import { EXTERNAL_TARGET, labelKey, titleKey } from './names.js';

export type Edge = {
  from: string;
  /** 遷移の ID */
  id: string;
  /** 行き先の画面 ID。アプリ外なら 'external' */
  to: string;
  params: Doc;
  auto: boolean;
  when?: string;
  else: boolean;
  /** stack の中の何番目のステップか（target の遷移なら undefined） */
  step?: number;
  stackKind?: 'navigate' | 'push' | 'replace';
  description?: string;
  /** L2 ファイル内の場所 */
  pointer: string;
};

export function transitionsOf(l2: Doc | undefined): Doc[] {
  return asArray(l2?.transitions).filter(isObj);
}

/** L2 だけから、遷移グラフ（辺の一覧）を導く */
export function buildGraph(project: Project): Edge[] {
  const edges: Edge[] = [];
  for (const [from, s] of project.screens) {
    if (!s.l2) continue;
    transitionsOf(s.l2.data).forEach((t, i) => {
      const base = {
        from,
        id: String(t.id ?? ''),
        auto: t.auto === true,
        else: t.else === true,
        ...(typeof t.when === 'string' && { when: t.when }),
        ...(typeof t.description === 'string' && { description: t.description }),
      };
      if (typeof t.target === 'string') {
        edges.push({
          ...base,
          to: t.target,
          params: asObj(t.params),
          pointer: `/transitions/${i}`,
        });
      } else if (Array.isArray(t.stack)) {
        t.stack.forEach((st, k) => {
          if (!isObj(st)) return;
          const kind = (['navigate', 'push', 'replace'] as const).find((x) => isObj(st[x]));
          if (!kind) return;
          const body = asObj(st[kind]);
          edges.push({
            ...base,
            to: String(body.to ?? ''),
            params: asObj(body.params),
            step: k,
            stackKind: kind,
            pointer: `/transitions/${i}/stack/${k}`,
          });
        });
      }
    });
  }
  return edges;
}

/** entry / root から到達できる画面（予約語 external は含まない） */
export function reachableScreens(project: Project, edges: Edge[]): Set<string> {
  const reached = new Set<string>();
  const queue: string[] = [];
  for (const [id, s] of project.screens) {
    if (s.l2 && (s.l2.data.entry === true || s.l2.data.root === true)) {
      reached.add(id);
      queue.push(id);
    }
  }
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const to of out.get(cur) ?? []) {
      if (to !== EXTERNAL_TARGET && project.screens.has(to) && !reached.has(to)) {
        reached.add(to);
        queue.push(to);
      }
    }
  }
  return reached;
}

/** 画面ごとの、L3 の action と L4 の go が参照している遷移 ID / イベントキー */
export type Usage = {
  /** L3 の action（部品・メニュー項目）が参照している名前 */
  actions: Set<string>;
  /** L4 の go が参照している遷移 ID */
  gos: Set<string>;
};

function collectNodeActions(node: unknown, out: Set<string>): void {
  if (!isObj(node)) return;
  if (typeof node.action === 'string') out.add(node.action);
  for (const m of asArray(node.menu)) {
    if (isObj(m) && typeof m.action === 'string') out.add(m.action);
  }
  for (const c of asArray(node.children)) collectNodeActions(c, out);
  if (isObj(node.layout)) collectNodeActions(node.layout, out);
}

export function stepsOf(event: unknown): Doc[] {
  if (!isObj(event)) return [];
  return [...asArray(event.steps), ...asArray(event.onError)].filter(isObj);
}

export function usageOf(screen: { l3?: { data: Doc }; l4?: { data: Doc } }): Usage {
  const actions = new Set<string>();
  const l3 = screen.l3?.data;
  if (l3) {
    collectNodeActions(l3.layout, actions);
    for (const n of asArray(l3.headerRight)) collectNodeActions(n, actions);
  }
  const gos = new Set<string>();
  for (const ev of Object.values(asObj(screen.l4?.data.events))) {
    for (const st of stepsOf(ev)) if (typeof st.go === 'string') gos.add(st.go);
  }
  return { actions, gos };
}

/** 遷移の起動のしかたを導く（auto は L2 が宣言） */
export function triggerKinds(
  edgeAuto: boolean,
  id: string,
  usage: Usage
): Array<'auto' | 'ui' | 'event'> {
  if (edgeAuto) return ['auto'];
  const kinds: Array<'ui' | 'event'> = [];
  if (usage.actions.has(id)) kinds.push('ui');
  if (usage.gos.has(id)) kinds.push('event');
  return kinds;
}

/* ================================
 * ja の文言（生成物の元）
 * ================================ */

function collectNodeTexts(node: unknown, screenId: string, out: Map<string, string>): void {
  if (!isObj(node)) return;
  if (typeof node.id === 'string' && typeof node.name === 'string' && node.name.length > 0) {
    out.set(labelKey(screenId, node.id), node.name);
  }
  for (const m of asArray(node.menu)) {
    if (isObj(m) && typeof m.id === 'string' && typeof m.label === 'string' && m.label.length > 0) {
      out.set(labelKey(screenId, m.id), m.label);
    }
  }
  for (const c of asArray(node.children)) collectNodeTexts(c, screenId, out);
  if (isObj(node.layout)) collectNodeTexts(node.layout, screenId, out);
}

/** 仕様から導かれる ja の文言（キー → 文言）。キーの昇順 */
export function expectedJa(project: Project): Map<string, string> {
  const m = new Map<string, string>();
  for (const [id, s] of project.screens) {
    if (s.l2 && typeof s.l2.data.name === 'string' && s.l2.data.name.length > 0) {
      m.set(titleKey(id), s.l2.data.name);
    }
    if (s.l3) {
      collectNodeTexts(s.l3.data.layout, id, m);
      for (const n of asArray(s.l3.data.headerRight)) collectNodeTexts(n, id, m);
    }
  }
  return new Map([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
