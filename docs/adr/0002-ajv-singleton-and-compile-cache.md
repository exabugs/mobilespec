# ADR-0002: AJV を singleton 化し、compile 結果をキャッシュする

- Status: Accepted
- Date: 2026-02-15
- Owner: (your name)

## Context

mobilespec では JSON Schema（draft 2020-12）を SSOT とし、AJV を用いて L2/L3/L4 のスキーマ検証を行っている。

`openapiCheck` を AJV ベースに統一した後、テスト実行時に以下のエラーが発生した。

```

schema with key or id "urn:mobilespec:L4.state" already exists

```

原因は以下である：

- `L4.state.schema.json` には `$id: "urn:mobilespec:L4.state"` が定義されている
- AJV の singleton インスタンスに対して、同じ `$id` を持つ schema を複数回 `compile()` すると
  AJV が内部 registry で重複登録を検出しエラーを投げる
- テスト実行中に `compile()` が複数回呼ばれ、同一スキーマが再登録された

AJV はスキーマを内部的に ID ベースで管理しているため、同じ `$id` のスキーマを複数回登録する設計は想定されていない。

## Decision

1. AJV インスタンスはプロセス内で singleton とする。
   - `src/lib/ajv.ts` に集約する。

2. スキーマの compile 結果はキャッシュする。
   - `schemaPath` 単位でキャッシュする
   - `$id` が存在する場合は `$id` 単位でもキャッシュする
   - 既に AJV に登録済みの `$id` がある場合は `ajv.getSchema(id)` を再利用する

3. `compileSchema()` は以下のポリシーで動作する：
   - 既に compile 済みであれば再利用する
   - 未登録の場合のみ `ajv.compile()` を呼ぶ
   - `$id` を持つ schema の二重登録を回避する

## Rationale

- JSON Schema は SSOT であり、同一スキーマを複数回 compile する必然性はない
- AJV の内部 registry 設計に合わせた形にすることで、実行時エラーを回避できる
- compile キャッシュによりパフォーマンスも改善される（テスト実行時の重複 compile 回避）
- AJV 設定（strict, formats, custom keywords 等）を一箇所に集約できる

## Alternatives Considered

### A) AJV を毎回 new する（singleton にしない）

- Pros:
  - `$id` 重複問題は発生しない
- Cons:
  - AJV 設定が分散しやすい
  - パフォーマンスが悪化する可能性
  - 「JSON Schema を SSOT として一元管理する」思想とズレる

### B) `$id` をスキーマから削除する

- Pros:
  - 重複問題は回避できる
- Cons:
  - `$id` は JSON Schema として正しい設計要素であり、削除は後退
  - 将来的な `$ref` 利用時に不利になる

## Consequences

- AJV の使用は `src/lib/ajv.ts` に限定される
- 他のモジュールは AJV を直接 new しない
- スキーマ compile は常に `compileSchema()` を経由する
- `$id` を持つスキーマも安全に再利用可能

## Verification

- `tests/validate.test.ts` が green
- `tests/openapiCheck.test.ts` が green
- 同一スキーマを複数回利用しても `$id already exists` エラーが発生しない
