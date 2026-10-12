# Changelog

## [Unreleased] — 2.0.0

**目的**: ① AI が効率的に動作できる ② 人間向けドキュメントの効率的なソース。レイヤー（L2 / L3 / L4）を保ったまま、重複をなくし、構造的な SSOT にした。

> **利用側へ**: 書式が変わる。公開前に、1.x の利用側は `~1.1.8` に固定すること。移行は `mobilespec migrate`。再利用ワークフロー `sdd-check.yml@main` を使う利用側は、`mobilespec_version: 1.1.8` を指定して 1.x に留めること（既定は 2 になった）。

### Breaking

- 仕様の書式を version 2 にした: `app.yaml`（`mobilespec.config.yml` と `L2.guards.yaml` の後継。`facts` が guard の後継）、画面の ID はファイル名（`screen:` の包みと `id` を廃止）
- L2: `trigger` / `type` / `exit` を廃止（導出）。遷移の `guard` → `when`、`targetContext` と `context` を廃止
- L3: `action` を持つ部品の `visibleWhen` を禁止（`unavailable: hide | disable`）。式は書けない（参照だけ）
- L4: 遷移の行き先を持てない（`navigate` / `navigateStack` は L2 へ。L4 からは `go` で L2 の遷移を参照）。`state` は型付き。`conditions` は式。`events` は `steps`（`mutate` / `refetch` / `set` / `go` / `external`）
- 重複・置き場所の誤りは error になる（正しい置き場所を案内する）
- CLI: 出力形式が変わった（要約行、i18n は locale ごとの集計）

- CLI: 旧 `mermaid` / `i18n` / `openapi-check` を削除（`update` / `check` に統合）。`update` は ja.json・索引・遷移図の更新になった。ライブラリの exports は `.` と `./validate` のみ（`./mermaid` などを削除）
- `sdd-check.yml` は `check` と `update --check` を実行する（`openapi-check` を廃止。`openapi_path` は `check` に渡す）

### Added

- `check --format json`（`code` / `file` / `pointer` / `found` / `expected` / `suggest`）、`--screen`、`--verbose`
- AI 向け: `index`、`context <id>`、`new`、`guide`、`update [--check]`
- 人間向け: `docs`（Markdown + Mermaid）、`export`（JSON）
- `migrate`: 旧体系（1.x）→ version 2。dry-run と `--to`。コメントは `x-legacyComments` に退避し、決められないものは TODO として報告
- 式の解析（構文、存在しない名前、条件の循環。実行はしない）と型の言語（OpenAPI との照合）
- OpenAPI との接続の検証（`operationId`、`args` の必須・未知・型）
- `--openapi` の相対パスはカレント基準（仕様ディレクトリ基準にもフォールバック）

### Changed

- 再利用ワークフロー `sdd-check.yml` を、公開済みの `@exabugs/mobilespec` を使う形に作り直した。`mobilespec_version` を追加
- 自身の CI を pnpm にし、lint・format check を追加。テストの失敗が CI の失敗になる

### Fixed

- README の「event ↔ L2 transition 不一致 → error」は実装と違っていた
