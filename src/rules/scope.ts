// src/rules/scope.ts
//
// 参照が解決できる名前の範囲（スコープ）。
// 画面ごとに、params（L2）、state / data / sources / conditions（L4）、facts（app.yaml）から作る。
import { type Doc, type Project, type ScreenFiles, asArray, asObj, isObj } from '../core/model.js';

export type NameKind = 'state' | 'query' | 'mutation' | 'source' | 'condition' | 'fact';

export type Scope = {
  /** L2 の params の名前 */
  params: Map<string, Doc>;
  /** 名前 → 種類（state / query / mutation / source / condition / fact） */
  names: Map<string, NameKind>;
};

/** 参照の位置ごとに許す名前の種類 */
export type Position =
  | 'when' // L2 の when / L4 の when: facts・conditions・state
  | 'visibleWhen' // L3: facts・conditions・state
  | 'repeatFrom' // L3: state・query・source・params
  | 'expr' // L4 の conditions[].expr: すべて（自分自身の condition を含む）
  | 'value'; // params / args / set / props の値: params・state・query・source・condition

const ALLOWED: Record<Position, ReadonlySet<NameKind>> = {
  when: new Set(['fact', 'condition', 'state']),
  visibleWhen: new Set(['fact', 'condition', 'state']),
  repeatFrom: new Set(['state', 'query', 'source']),
  expr: new Set(['state', 'query', 'mutation', 'source', 'condition', 'fact']),
  value: new Set(['state', 'query', 'source', 'condition', 'fact']),
};

export const allowedKinds = (p: Position): ReadonlySet<NameKind> => ALLOWED[p];

/** params を参照できる位置（$params.x） */
export const PARAMS_ALLOWED: Record<Position, boolean> = {
  when: true,
  visibleWhen: false,
  repeatFrom: true,
  expr: true,
  value: true,
};

export function factNames(project: Project): string[] {
  return Object.keys(asObj(project.app?.data.facts));
}

export function scopeOf(project: Project, screen: ScreenFiles): Scope {
  const params = new Map<string, Doc>();
  for (const p of asArray(screen.l2?.data.params)) {
    if (isObj(p) && typeof p.name === 'string') params.set(p.name, p);
  }
  const names = new Map<string, NameKind>();
  for (const f of factNames(project)) names.set(f, 'fact');
  const l4 = screen.l4?.data;
  if (l4) {
    for (const s of asArray(l4.state)) {
      if (isObj(s) && typeof s.name === 'string') names.set(s.name, 'state');
    }
    const data = asObj(l4.data);
    for (const k of Object.keys(asObj(data.queries))) names.set(k, 'query');
    for (const k of Object.keys(asObj(data.mutations))) names.set(k, 'mutation');
    for (const k of Object.keys(asObj(l4.sources))) names.set(k, 'source');
    for (const k of Object.keys(asObj(l4.conditions))) names.set(k, 'condition');
  }
  return { params, names };
}

/** クエリ・ミューテーションの結果が持つ、予約済みのメンバー */
export const QUERY_MEMBERS = ['data', 'isPending', 'isError', 'error'] as const;
export const MUTATION_MEMBERS = ['isPending', 'isError', 'error'] as const;
