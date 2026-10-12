// src/migrate/helpers.ts — 変換の共通部品（API の解決、式の変換）
import { collectRefs, parseExpr } from '../core/expr.js';
import { type OpenApiIndex, type Operation, findOperation } from '../core/openapi.js';

const API_RE = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s'"→)）、。]*)/;

export type ApiRef = { method: string; path: string };

/** 文字列から `METHOD /path` を取り出す */
export function findApiRef(text: unknown): ApiRef | undefined {
  if (typeof text !== 'string') return undefined;
  const m = API_RE.exec(text);
  return m ? { method: m[1], path: m[2].replace(/[.,;]+$/, '') } : undefined;
}

export function resolveApi(
  index: OpenApiIndex | undefined,
  ref: ApiRef | undefined
): Operation | undefined {
  if (!index || !ref) return undefined;
  return findOperation(index, ref.method, ref.path);
}

/**
 * 旧い散文の条件が、そのまま式として使えるなら式にする。
 * `===` → `==`、`!==` → `!=`、`not` → `!`、`and` → `&&`、`or` → `||` に正規化して構文解析し、
 * すべての参照が画面内の名前（クエリは除く: `.data` が要るため）に解決できる場合だけ。
 */
export function proseToExpr(prose: string, names: ReadonlyMap<string, string>): string | undefined {
  const norm = prose
    .trim()
    .replace(/===/g, '==')
    .replace(/!==/g, '!=')
    .replace(/\bnot\s+/g, '!')
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||');
  const r = parseExpr(norm);
  if (!r.ok) return undefined;
  for (const ref of collectRefs(r.ast)) {
    if (ref.dollar) return undefined;
    const kind = names.get(ref.root);
    if (kind === undefined || kind === 'query' || kind === 'mutation') return undefined;
  }
  return norm;
}
