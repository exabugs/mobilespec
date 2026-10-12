// src/core/expr.ts
//
// 参照と式の構文解析。**実行はしない**（任意コードの実行はしない）。構文を解析して、参照を取り出し検証するだけ。
//
// - 参照（reference）: `$?ident(.ident|.数字)*`。L2 / L3 / L4 のあらゆる値の位置で書ける
// - 式（expression）: 参照に演算を加えたもの。**L4 の conditions[].expr にだけ**書ける（S3）
//   演算: ! && || == != < <= > >=、括弧、リテラル（文字列・数値・真偽値・null）
// - 値の位置（params / args / set / props の値）: `$` で始まる文字列は参照、それ以外はリテラル

export type RefNode = {
  t: 'ref';
  /** 先頭の識別子（`$params` の場合は 'params'） */
  root: string;
  /** `$` で始まっていたか */
  dollar: boolean;
  /** root 以降のドット区切り */
  path: string[];
  pos: number;
};

export type LitNode = { t: 'lit'; value: string | number | boolean | null };
export type NotNode = { t: 'not'; arg: ExprNode };
export type BinNode = { t: 'bin'; op: '&&' | '||'; left: ExprNode; right: ExprNode };
export type CmpNode = {
  t: 'cmp';
  op: '==' | '!=' | '<' | '<=' | '>' | '>=';
  left: ExprNode;
  right: ExprNode;
};
export type ExprNode = RefNode | LitNode | NotNode | BinNode | CmpNode;

export type ParseResult = { ok: true; ast: ExprNode } | { ok: false; message: string; pos: number };

type Token =
  | { k: 'ref'; root: string; dollar: boolean; path: string[]; pos: number }
  | { k: 'str' | 'num' | 'bool' | 'null'; value: string | number | boolean | null; pos: number }
  | { k: 'op'; value: string; pos: number };

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

function tokenize(src: string): { tokens: Token[] } | { error: string; pos: number } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // 文字列
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < src.length) {
          s += src[j + 1];
          j += 2;
        } else {
          s += src[j++];
        }
      }
      if (j >= src.length) return { error: '文字列が閉じられていません', pos: i };
      tokens.push({ k: 'str', value: s, pos: i });
      i = j + 1;
      continue;
    }
    // 数値
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const text = src.slice(i, j);
      const n = Number(text);
      if (Number.isNaN(n)) return { error: `数値が不正です: ${text}`, pos: i };
      tokens.push({ k: 'num', value: n, pos: i });
      i = j;
      continue;
    }
    // 参照・キーワード
    if (c === '$' || IDENT_START.test(c)) {
      const dollar = c === '$';
      let j = dollar ? i + 1 : i;
      if (!IDENT_START.test(src[j] ?? '')) return { error: '`$` の後に名前がありません', pos: i };
      const parts: string[] = [];
      let start = j;
      for (;;) {
        while (j < src.length && IDENT_PART.test(src[j])) j++;
        parts.push(src.slice(start, j));
        if (src[j] === '.' && /[A-Za-z0-9_]/.test(src[j + 1] ?? '')) {
          j++;
          start = j;
          continue;
        }
        break;
      }
      const [root, ...path] = parts;
      if (!dollar && path.length === 0) {
        if (root === 'true' || root === 'false') {
          tokens.push({ k: 'bool', value: root === 'true', pos: i });
          i = j;
          continue;
        }
        if (root === 'null') {
          tokens.push({ k: 'null', value: null, pos: i });
          i = j;
          continue;
        }
      }
      tokens.push({ k: 'ref', root, dollar, path, pos: i });
      i = j;
      continue;
    }
    // 演算子
    const two = src.slice(i, i + 2);
    if (['&&', '||', '==', '!=', '<=', '>='].includes(two)) {
      tokens.push({ k: 'op', value: two, pos: i });
      i += 2;
      continue;
    }
    if (['!', '<', '>', '(', ')'].includes(c)) {
      tokens.push({ k: 'op', value: c, pos: i });
      i++;
      continue;
    }
    return { error: `使えない文字です: ${c}`, pos: i };
  }
  return { tokens };
}

/** 式を構文解析する（実行しない） */
export function parseExpr(src: string): ParseResult {
  const tk = tokenize(src);
  if ('error' in tk) return { ok: false, message: tk.error, pos: tk.pos };
  const { tokens } = tk;
  let p = 0;

  const peek = (): Token | undefined => tokens[p];
  const isOp = (v: string): boolean => {
    const t = peek();
    return t !== undefined && t.k === 'op' && t.value === v;
  };

  class ParseError extends Error {
    constructor(
      message: string,
      public pos: number
    ) {
      super(message);
    }
  }

  const parseOr = (): ExprNode => {
    let left = parseAnd();
    while (isOp('||')) {
      p++;
      left = { t: 'bin', op: '||', left, right: parseAnd() };
    }
    return left;
  };
  const parseAnd = (): ExprNode => {
    let left = parseCmp();
    while (isOp('&&')) {
      p++;
      left = { t: 'bin', op: '&&', left, right: parseCmp() };
    }
    return left;
  };
  const parseCmp = (): ExprNode => {
    const left = parseUnary();
    const t = peek();
    if (t && t.k === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.value)) {
      p++;
      return { t: 'cmp', op: t.value as CmpNode['op'], left, right: parseUnary() };
    }
    return left;
  };
  const parseUnary = (): ExprNode => {
    if (isOp('!')) {
      p++;
      return { t: 'not', arg: parseUnary() };
    }
    return parsePrimary();
  };
  const parsePrimary = (): ExprNode => {
    const t = peek();
    if (!t) throw new ParseError('式が途中で終わっています', src.length);
    p++;
    switch (t.k) {
      case 'op':
        if (t.value === '(') {
          const inner = parseOr();
          if (!isOp(')')) throw new ParseError('`)` がありません', peek()?.pos ?? src.length);
          p++;
          return inner;
        }
        throw new ParseError(`ここに演算子 ${t.value} は書けません`, t.pos);
      case 'ref':
        return { t: 'ref', root: t.root, dollar: t.dollar, path: t.path, pos: t.pos };
      case 'str':
      case 'num':
      case 'bool':
      case 'null':
        return { t: 'lit', value: t.value };
    }
  };

  try {
    if (tokens.length === 0) return { ok: false, message: '式が空です', pos: 0 };
    const ast = parseOr();
    if (p < tokens.length) {
      return { ok: false, message: '式の途中に余分なものがあります', pos: tokens[p].pos };
    }
    return { ok: true, ast };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, message: e.message, pos: e.pos };
    throw e;
  }
}

/** 式から、参照をすべて取り出す */
export function collectRefs(ast: ExprNode): RefNode[] {
  switch (ast.t) {
    case 'ref':
      return [ast];
    case 'lit':
      return [];
    case 'not':
      return collectRefs(ast.arg);
    case 'bin':
    case 'cmp':
      return [...collectRefs(ast.left), ...collectRefs(ast.right)];
  }
}

/** 参照だけの式（演算子を含まない）か */
export function isPlainRef(ast: ExprNode): ast is RefNode {
  return ast.t === 'ref';
}

/** 参照の位置で書かれた文字列を解析する。演算子を含む場合は、そうであることを返す */
export type ReferenceResult =
  | { ok: true; ref: RefNode }
  | { ok: false; kind: 'syntax'; message: string; pos: number }
  | { ok: false; kind: 'not-reference'; message: string; ast: ExprNode };

export function parseReference(src: string): ReferenceResult {
  const r = parseExpr(src);
  if (!r.ok) return { ok: false, kind: 'syntax', message: r.message, pos: r.pos };
  if (isPlainRef(r.ast)) return { ok: true, ref: r.ast };
  return {
    ok: false,
    kind: 'not-reference',
    message:
      'ここには参照（名前）だけを書けます。演算子を持つ式は L4 の conditions に書き、その名前を参照してください',
    ast: r.ast,
  };
}

/** 値の位置の文字列が参照か（`$` で始まる） */
export function isReferenceValue(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('$');
}

/** 参照を文字列に戻す（診断・出力用） */
export function refToString(r: RefNode): string {
  return `${r.dollar ? '$' : ''}${[r.root, ...r.path].join('.')}`;
}
