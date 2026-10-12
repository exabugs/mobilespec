# mobilespec

モバイルアプリの仕様（画面の接続 L2 / UI L3 / 状態・データ L4）を、**構造として検証し、AI と人の両方に渡す**ためのエンジン。

目的は 2 つ。

1. **AI が効率的に動作できる** — 1 画面ぶんの文脈を解決済みで取り出せる。診断は機械可読で、直す場所と候補が付く
2. **人間向けドキュメントの効率的なソース** — 仕様から Markdown + Mermaid と JSON を生成する。手で書いた図や表を持たない

構造は 3 層に分かれ、**1 つの事実は 1 か所**にだけ書く（構造的な SSOT）。

| レイヤー | 持つもの                                                     | 持たないもの                      |
| -------- | ------------------------------------------------------------ | --------------------------------- |
| L2       | 画面間の接続（遷移、params、起点）。**接続はここだけを見る** | UI、状態、API                     |
| L3       | UI の構造、各部品が起動する action                           | 条件の式、遷移の行き先            |
| L4       | 状態、API の呼び出し、条件（式）、画面内の振る舞い           | 遷移の行き先（`go` で L2 を参照） |

違反（重複・置き場所の誤り）は error になり、正しい置き場所が案内される。

## 構成

```text
specs/
  app.yaml                           version: 2 / groups / locales / openapi / facts
  L2.screenflows/**/<id>.flow.yaml   画面の ID はファイル名
  L3.ui/**/<id>.ui.yaml
  L4.state/**/<id>.state.yaml
  i18n/ja.json                       生成物（手で編集しない）
  .mobilespec/                       生成物（索引・遷移図）
```

仕様の書き方は [docs/LLM_SPEC.md](docs/LLM_SPEC.md)（`mobilespec guide` で出力）。設計の背景は [docs/design/spec-redesign.md](docs/design/spec-redesign.md)。

## CLI

```bash
mobilespec check [--screen <id>] [--format json] [--verbose]   # 検証（read-only）。error があれば終了コード 1
mobilespec index                                               # 全体の索引（AI 向け）
mobilespec context <screen-id> [--format json] [--docs]        # 1 画面の文脈（AI 向け）
mobilespec new <screen-id> --group <g> [--name <ja>]           # 最小の有効な画面
mobilespec guide                                               # AI 向けの短い仕様
mobilespec update [--check]                                    # 生成物の更新 / 最新かの検査
mobilespec docs [--out <dir>]                                  # 人間向けドキュメント（Markdown + Mermaid）
mobilespec export                                              # 全体の機械可読モデル（JSON）
mobilespec migrate [--to <dir>]                                # 旧体系（1.x）→ version 2。--to なしは dry-run
```

共通: `--specs-dir <dir>`（既定: カレント）、`--openapi <path>`（カレント基準）、`--schema-dir <dir>`。

## 診断

error は「実装不能」のものだけ。`info` は状況の可視化（CI を落とさない）。warning はない。

`check --format json` の各診断は `code` / `level` / `file` / `pointer` / `found` / `expected` / `suggest` を持つ。`file` + `pointer` が直す場所、`suggest` が最も近い有効な候補。

## 1.x からの移行

version 2 は**破壊的変更**を含む（ファイルの書式、`context` の廃止、guard の `facts` への統合など）。`mobilespec migrate` が変換する。決められないものは TODO として報告し、コメントは `x-legacyComments` に残す。1.x に留まる利用側は `~1.1.8` に固定する。

## CI

```yaml
jobs:
  sdd:
    uses: exabugs/mobilespec/.github/workflows/sdd-check.yml@main
    with:
      specs_dir: specs/mobile
      openapi_path: docs/specs/openapi.bundled.yaml # 任意（リポジトリのルートからの相対パス）
```

CI は `check` と `update --check` だけを実行する（ファイルを書かない）。

## ドキュメント

[docs/01_principles.md](docs/01_principles.md)（原則）、[02_structure_model.md](docs/02_structure_model.md)（構造）、[03_validation_model.md](docs/03_validation_model.md)（検証）、[04_ci_policy.md](docs/04_ci_policy.md)、[05_lifecycle.md](docs/05_lifecycle.md)、[06_ai_collaboration.md](docs/06_ai_collaboration.md)、[07_configuration.md](docs/07_configuration.md)。
