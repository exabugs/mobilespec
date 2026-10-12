// src/rules/refs.ts
//
// 参照・式の検証。参照の位置ごとに、書けるものを制限する（S3: ロジックは L4 だけ）。
// 解決できない名前には、候補（expected）と最も近い候補（suggest）を付ける。
import { type Diagnostic, notFound } from '../core/diagnostic.js';
import {
  type RefNode,
  collectRefs,
  isReferenceValue,
  parseExpr,
  parseReference,
  refToString,
} from '../core/expr.js';
import { isObj } from '../core/model.js';
import {
  MUTATION_MEMBERS,
  PARAMS_ALLOWED,
  type Position,
  QUERY_MEMBERS,
  type Scope,
  allowedKinds,
} from './scope.js';

export class RefChecker {
  /** 参照された params */
  readonly usedParams = new Set<string>();

  /**
   * @param used 参照された名前の集合（未使用の定義の検出に使う）。画面の L2 / L3 / L4 で共有する
   */
  constructor(
    private readonly scope: Scope,
    private readonly sink: Diagnostic[],
    private readonly file: string,
    readonly used: Set<string> = new Set<string>()
  ) {}

  private resolve(ref: RefNode, position: Position, pointer: string): void {
    const text = refToString(ref);
    const candidates = (): string[] => {
      const kinds = allowedKinds(position);
      const names = [...this.scope.names.entries()].filter(([, k]) => kinds.has(k)).map(([n]) => n);
      const ps = PARAMS_ALLOWED[position]
        ? [...this.scope.params.keys()].map((p) => `$params.${p}`)
        : [];
      return [...names, ...ps];
    };

    // $params.x
    if (ref.dollar && ref.root === 'params') {
      if (!PARAMS_ALLOWED[position]) {
        this.sink.push({
          code: 'UNKNOWN_REFERENCE',
          level: 'error',
          file: this.file,
          pointer,
          found: text,
          message: `この位置では $params は参照できません: ${text}`,
        });
        return;
      }
      const name = ref.path[0];
      if (name === undefined) {
        this.sink.push({
          code: 'UNKNOWN_REFERENCE',
          level: 'error',
          file: this.file,
          pointer,
          found: text,
          message: `パラメータ名を指定してください（例: $params.id）`,
        });
        return;
      }
      if (!this.scope.params.has(name)) {
        this.sink.push(
          notFound(
            { code: 'UNKNOWN_REFERENCE', file: this.file, pointer },
            `パラメータ "${name}" が L2 の params に宣言されていません: ${text}`,
            `$params.${name}`,
            [...this.scope.params.keys()].map((p) => `$params.${p}`)
          )
        );
        return;
      }
      this.usedParams.add(name);
      return;
    }

    const kind = this.scope.names.get(ref.root);
    if (kind === undefined) {
      this.sink.push(
        notFound(
          { code: 'UNKNOWN_REFERENCE', file: this.file, pointer },
          `参照する名前 "${ref.root}" が存在しません: ${text}`,
          ref.root,
          candidates()
        )
      );
      return;
    }
    if (!allowedKinds(position).has(kind)) {
      this.sink.push({
        code: 'UNKNOWN_REFERENCE',
        level: 'error',
        file: this.file,
        pointer,
        found: text,
        expected: candidates().sort(),
        message: `この位置では ${kind} "${ref.root}" は参照できません（参照できるのは: ${[...allowedKinds(position)].join(' / ')}）`,
      });
      return;
    }
    this.used.add(ref.root);

    // メンバー
    const first = ref.path[0];
    if (
      kind === 'query' &&
      first !== undefined &&
      !(QUERY_MEMBERS as readonly string[]).includes(first)
    ) {
      this.sink.push(
        notFound(
          { code: 'UNKNOWN_REFERENCE', file: this.file, pointer },
          `クエリ "${ref.root}" のメンバー "${first}" は使えません（${QUERY_MEMBERS.join(' / ')}）: ${text}`,
          first,
          QUERY_MEMBERS
        )
      );
    }
    if (
      kind === 'mutation' &&
      first !== undefined &&
      !(MUTATION_MEMBERS as readonly string[]).includes(first)
    ) {
      this.sink.push(
        notFound(
          { code: 'UNKNOWN_REFERENCE', file: this.file, pointer },
          `ミューテーション "${ref.root}" のメンバー "${first}" は使えません（${MUTATION_MEMBERS.join(' / ')}）: ${text}`,
          first,
          MUTATION_MEMBERS
        )
      );
    }
    if ((kind === 'condition' || kind === 'fact') && ref.path.length > 0) {
      this.sink.push({
        code: 'UNKNOWN_REFERENCE',
        level: 'error',
        file: this.file,
        pointer,
        found: text,
        message: `${kind === 'fact' ? 'fact' : '条件'} "${ref.root}" は真偽値です。メンバーは参照できません: ${text}`,
      });
    }
  }

  /** 参照の位置（when / visibleWhen / repeatFrom）。参照だけを書ける */
  checkReference(pointer: string, text: unknown, position: Position): void {
    if (typeof text !== 'string') return;
    const r = parseReference(text);
    if (!r.ok) {
      this.sink.push({
        code: r.kind === 'syntax' ? 'EXPRESSION_SYNTAX' : 'EXPRESSION_NOT_ALLOWED',
        level: 'error',
        file: this.file,
        pointer,
        found: text,
        message:
          r.kind === 'syntax' ? `参照の構文エラー: ${r.message}: ${text}` : `${r.message}: ${text}`,
      });
      return;
    }
    this.resolve(r.ref, position, pointer);
  }

  /** 式の位置（L4 の conditions[].expr）。演算子を書ける */
  checkExpression(pointer: string, text: unknown, position: Position = 'expr'): RefNode[] {
    if (typeof text !== 'string') return [];
    const r = parseExpr(text);
    if (!r.ok) {
      this.sink.push({
        code: 'EXPRESSION_SYNTAX',
        level: 'error',
        file: this.file,
        pointer,
        found: text,
        message: `式の構文エラー（${r.pos + 1} 文字目）: ${r.message}: ${text}`,
      });
      return [];
    }
    const refs = collectRefs(r.ast);
    for (const ref of refs) this.resolve(ref, position, pointer);
    return refs;
  }

  /** 値の位置（params / args / set / props）。`$` で始まる文字列は参照、それ以外はリテラル */
  checkValue(pointer: string, value: unknown, position: Position = 'value'): void {
    if (isReferenceValue(value)) {
      this.checkReference(pointer, value, position);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => this.checkValue(`${pointer}/${i}`, v, position));
    } else if (isObj(value)) {
      for (const [k, v] of Object.entries(value)) this.checkValue(`${pointer}/${k}`, v, position);
    }
  }
}
