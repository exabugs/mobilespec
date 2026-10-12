// tests/core.test.ts — 参照・式・型・診断の部品
import { describe, expect, it } from 'vitest';

import { closest, distance } from '../src/core/diagnostic.js';
import {
  collectRefs,
  isPlainRef,
  parseExpr,
  parseReference,
  refToString,
} from '../src/core/expr.js';
import { literalMismatch, parseType, typeToString } from '../src/core/typelang.js';

describe('parseExpr', () => {
  it('参照・リテラル・演算子を解析する（実行はしない）', () => {
    const r = parseExpr("!myStatus.data && !item.isPending && isSignedIn || tab == 'members'");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(collectRefs(r.ast).map(refToString)).toEqual([
      'myStatus.data',
      'item.isPending',
      'isSignedIn',
      'tab',
    ]);
  });

  it('$ 付きの参照と、.length / 数字の添字', () => {
    const r = parseExpr('$params.id != null && list.length > 0 && items.0.ok');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(collectRefs(r.ast).map(refToString)).toEqual([
      '$params.id',
      'list.length',
      'items.0.ok',
    ]);
  });

  it('括弧と優先順位: && は || より強い', () => {
    const r = parseExpr('a || b && c');
    expect(r.ok && r.ast.t === 'bin' && r.ast.op === '||').toBe(true);
    const r2 = parseExpr('(a || b) && c');
    expect(r2.ok && r2.ast.t === 'bin' && r2.ast.op === '&&').toBe(true);
  });

  it.each([
    ['', '式が空'],
    ['a &&', '途中で終わって'],
    ['a b', '余分'],
    ['(a', '`)`'],
    ["a == 'x", '閉じられて'],
    ['a = b', '使えない文字'],
    ['$', '名前がありません'],
    ['foo()', '余分'],
  ])('構文エラー: %j', (src, fragment) => {
    const r = parseExpr(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(fragment);
  });

  it('任意コードは書けない（関数呼び出し・代入・メンバーアクセスの括弧）', () => {
    for (const src of ['alert(1)', 'a = 1', 'a.b()', 'x; y', '`t`', 'a ? b : c']) {
      expect(parseExpr(src).ok).toBe(false);
    }
  });
});

describe('parseReference（参照の位置）', () => {
  it('参照だけなら OK', () => {
    const r = parseReference('item.data.members');
    expect(r.ok).toBe(true);
    expect(parseReference('$params.id').ok).toBe(true);
  });

  it('演算子を含むものは、参照ではない（L4 の conditions に書く、と案内できる）', () => {
    const r = parseReference('a && b');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('not-reference');
    const neg = parseReference('!isLoading');
    expect(neg.ok).toBe(false);
  });

  it('構文エラーは syntax', () => {
    const r = parseReference('a &&');
    expect(!r.ok && r.kind).toBe('syntax');
  });

  it('isPlainRef', () => {
    const r = parseExpr('a.b');
    expect(r.ok && isPlainRef(r.ast)).toBe(true);
  });
});

describe('parseType', () => {
  it('プリミティブ・配列・オブジェクト・$ref・unknown', () => {
    expect(typeToString((parseType('string') as { type: never }).type)).toBe('string');
    expect(typeToString((parseType(['number']) as { type: never }).type)).toBe('[number]');
    expect(
      typeToString((parseType({ title: 'string', body: 'string?' }) as { type: never }).type)
    ).toBe('{ title: string, body?: string }');
    expect(parseType({ $ref: '#/components/schemas/Item' }).ok).toBe(true);
    expect(parseType('unknown').ok).toBe(true);
  });

  it.each([
    ['text', '使えません'],
    [['a', 'b'], '1 つだけ'],
    ['string?', '省略可'],
    [5, '文字列・配列・オブジェクト'],
    [{ a: 'nope' }, 'フィールド "a"'],
  ])('不正な型: %j', (v, fragment) => {
    const r = parseType(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(fragment);
  });
});

describe('literalMismatch', () => {
  it('リテラルが型に合うかを判定する。参照は判定しない', () => {
    const str = (parseType('string') as { type: never }).type;
    const int = (parseType('integer') as { type: never }).type;
    expect(literalMismatch(str, 'a')).toBeNull();
    expect(literalMismatch(str, 5)).toContain('代入できません');
    expect(literalMismatch(int, 1.5)).toContain('代入できません');
    expect(literalMismatch(str, '$params.x')).toBeNull();
    expect(literalMismatch(str, 'c', ['a', 'b'])).toContain('enum');
  });
});

describe('候補の提示', () => {
  it('綴りの近い候補を返す。遠ければ返さない', () => {
    expect(distance('canJoinn', 'canJoin')).toBe(1);
    expect(closest('canJoinn', ['canJoin', 'noMembers'])).toBe('canJoin');
    expect(closest('zzzzzz', ['canJoin', 'noMembers'])).toBeUndefined();
    expect(closest('x', [])).toBeUndefined();
  });
});
