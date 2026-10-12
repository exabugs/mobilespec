// src/core/typelang.ts
//
// 型の言語。
//   string | number | integer | boolean | unknown
//   [T]                        … 配列
//   { a: string, b: 'number?' } … オブジェクト（`?` で終わる型は省略可）
//   { $ref: '#/components/schemas/X' } … OpenAPI のスキーマ
// `unknown` は「型が未定義」（info）。段階的な移行のために許す。

export type Type =
  | { k: 'prim'; name: 'string' | 'number' | 'integer' | 'boolean' }
  | { k: 'unknown' }
  | { k: 'array'; item: Type }
  | { k: 'object'; fields: Record<string, { type: Type; optional: boolean }> }
  | { k: 'ref'; ref: string };

export type TypeParse = { ok: true; type: Type } | { ok: false; message: string };

const PRIMS = ['string', 'number', 'integer', 'boolean'] as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseInner(v: unknown, allowOptional: boolean): TypeParse & { optional?: boolean } {
  if (typeof v === 'string') {
    let name = v.trim();
    let optional = false;
    if (name.endsWith('?')) {
      if (!allowOptional) {
        return {
          ok: false,
          message: '`?`（省略可）は、オブジェクトのフィールドの型にだけ書けます',
        };
      }
      optional = true;
      name = name.slice(0, -1);
    }
    if (name === 'unknown') return { ok: true, type: { k: 'unknown' }, optional };
    if ((PRIMS as readonly string[]).includes(name)) {
      return { ok: true, type: { k: 'prim', name: name as (typeof PRIMS)[number] }, optional };
    }
    return {
      ok: false,
      message: `型 "${v}" は使えません（${[...PRIMS, 'unknown'].join(' / ')} / [T] / { … } / { $ref }）`,
    };
  }
  if (Array.isArray(v)) {
    if (v.length !== 1)
      return { ok: false, message: '配列の型は、要素の型を 1 つだけ書きます: [string]' };
    const item = parseInner(v[0], false);
    if (!item.ok) return item;
    return { ok: true, type: { k: 'array', item: item.type } };
  }
  if (isObj(v)) {
    if (Object.keys(v).length === 1 && typeof v.$ref === 'string') {
      return { ok: true, type: { k: 'ref', ref: v.$ref } };
    }
    const fields: Record<string, { type: Type; optional: boolean }> = {};
    for (const [key, fv] of Object.entries(v)) {
      const f = parseInner(fv, true);
      if (!f.ok) return { ok: false, message: `フィールド "${key}": ${f.message}` };
      fields[key] = { type: f.type, optional: f.optional === true };
    }
    return { ok: true, type: { k: 'object', fields } };
  }
  return { ok: false, message: '型は、文字列・配列・オブジェクトで書きます' };
}

export function parseType(v: unknown): TypeParse {
  const r = parseInner(v, false);
  return r.ok ? { ok: true, type: r.type } : r;
}

export function typeToString(t: Type): string {
  switch (t.k) {
    case 'prim':
      return t.name;
    case 'unknown':
      return 'unknown';
    case 'array':
      return `[${typeToString(t.item)}]`;
    case 'ref':
      return `$ref(${t.ref})`;
    case 'object':
      return `{ ${Object.entries(t.fields)
        .map(([k, f]) => `${k}${f.optional ? '?' : ''}: ${typeToString(f.type)}`)
        .join(', ')} }`;
  }
}

/** リテラルの値が、型に合うか。合わなければ理由を返す（判定できないものは null = 合うとみなす） */
export function literalMismatch(t: Type, value: unknown, enumValues?: unknown[]): string | null {
  if (typeof value === 'string' && value.startsWith('$')) return null; // 参照は、ここでは判定しない
  if (enumValues && enumValues.length > 0 && !enumValues.includes(value)) {
    return `値 ${JSON.stringify(value)} は enum（${enumValues.map((e) => JSON.stringify(e)).join(', ')}）にありません`;
  }
  switch (t.k) {
    case 'unknown':
    case 'ref':
      return null;
    case 'prim': {
      const ok =
        (t.name === 'string' && typeof value === 'string') ||
        (t.name === 'number' && typeof value === 'number') ||
        (t.name === 'integer' && typeof value === 'number' && Number.isInteger(value)) ||
        (t.name === 'boolean' && typeof value === 'boolean');
      return ok ? null : `型 ${t.name} に ${JSON.stringify(value)} は代入できません`;
    }
    case 'array':
      return Array.isArray(value)
        ? null
        : `型 ${typeToString(t)} に ${JSON.stringify(value)} は代入できません`;
    case 'object':
      return isObj(value)
        ? null
        : `型 ${typeToString(t)} に ${JSON.stringify(value)} は代入できません`;
  }
}
