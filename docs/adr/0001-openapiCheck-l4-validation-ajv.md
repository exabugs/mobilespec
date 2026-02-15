# ADR-0001: openapiCheck の L4 検証を AJV（JSON Schema）に統一する

- Status: Accepted
- Date: 2026-02-15
- Owner: exabugs

## Context

mobilespec では L2/L3/L4 を JSON Schema（draft 2020-12）で定義しており、`validate` は AJV によりスキーマ検証と横断整合チェックを行う。

一方 `openapiCheck` は OpenAPI の `operationId` と L4 の `screen.data.queries/mutations[].operationId` の整合を確認するために導入したが、L4 側の読み取り・検証に Zod の strict object を用いていたため、L4 の正式スキーマ（JSON Schema）で許容されるフィールド（例：`selectRoot`）が `openapiCheck` では不正扱いになるなど、L4 の解釈が `validate` と不一致になっていた。

また、ESM 環境で AJV（2020）を利用する際に `createRequire(import.meta.url)` を複数箇所に散在させると、初期化・設定が分裂しやすい問題があった。

## Decision

1. `openapiCheck` の L4 検証は、L4 の SSOT である `L4.state.schema.json` に準拠させる。
   - 具体的には `openapiCheck` の L4 パース/検証を Zod から AJV に変更し、`schemaDir/L4.state.schema.json` を用いて検証する。
   - L4 の `selectRoot` を含む `opRef` は JSON Schema 上許容されるため、`openapiCheck` でも不正扱いしない。

2. OpenAPI 側は、整合チェックに必要な最小情報（主に `paths/*/*/operationId`）だけを安全に抽出できればよい。
   - そのため OpenAPI 側の “拾うためのバリデーション” は Zod（loose/partial）を継続利用する。

3. AJV の生成とスキーマ compile は一箇所に集約する（例：`src/lib/ajv.ts`）。
   - AJV は singleton とし、`compileSchema` は schemaPath / `$id` 単位で compile 結果をキャッシュして再利用する。
   - これにより `$id` を持つスキーマの二重登録（`schema with key or id ... already exists`）を回避する。

## Alternatives Considered

### A) openapiCheck の L4 を Zod のまま維持する

- Pros: 依存が単純に見える
- Cons: L4 の SSOT（JSON Schema）と解釈が分裂し、将来の仕様追加/変更で不整合が発生しやすい

### B) OpenAPI も含めて AJV で厳密検証する

- Pros: すべて AJV に寄せられる
- Cons: OpenAPI の完全スキーマ検証は目的に対して過剰。OpenAPI の公式スキーマ管理や運用コストが増える

## Consequences

- `validate` と `openapiCheck` の L4 解釈が一致し、仕様追加（例：`selectRoot`）で片方だけ壊れるリスクが下がる。
- AJV 初期化が一元化され、strict/allErrors 等のオプションや追加 keyword/format の管理が容易になる。
- テストは「機能とテストはセット」を原則とし、`openapiCheck` の L4 側は JSON Schema に従うことをテストで固定する。
- OpenAPI 側は “必要最小限の抽出” に留め、厳密な OpenAPI 検証はスコープ外とする。

## Verification

- `tests/validate.test.ts` が green
- `tests/openapiCheck.test.ts` が green
- L4 に `selectRoot` を含めても `openapiCheck` が `L4 invalid` を出さないことをテストで保証する
