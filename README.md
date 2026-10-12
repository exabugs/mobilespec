# mobilespec

## Structure-Driven Development (SDD) 仕様エンジン

mobilespec は  
**Structure-Driven Development（構造駆動開発）** を実践するための  
構造検証・可視化・契約整合エンジンです。

---

## 🎯 SDD とは

SDD は、

- API 構造（OpenAPI）
- 画面遷移構造（L2）
- UI 構成構造（L3）
- 状態・データ契約構造（L4）

を **唯一の正（SSOT）** とし、

実装コードを生成物として扱う開発手法です。

---

## 🧠 基本原則

1. 構造が正、実装は生成物
2. OpenAPI は API 契約の唯一の正
3. L2 / L3 / L4 は UI 契約の唯一の正
4. URL / HTTP メソッド直書き禁止
5. L4 は operationId のみ参照
6. selectRoot は必須（OpenAPI で証明可能であること）
7. 契約違反は CI が検知する（AIは検知しない）

---

## 🔎 診断ポリシー（固定）

mobilespec は **2段階のみ** を採用する。

| level | 意味                   |
| ----- | ---------------------- |
| error | 実装不能（CI fail）    |
| info  | 状態可視化（常時表示） |

warning は使用しない。

---

## 🔗 構造接続ルール

```txt
L3.action
↓
L2.transition.id
↓
L4.events key
↓
L4.data (query/mutation key)
↓
OpenAPI.operationId
```

この縦接続が成立している状態を  
**Structural Integrity（構造整合）** と呼ぶ。

---

## 📐 検証内容

### L2

- screen 重複
- 遷移ターゲット不正
- entry から到達不能 screen → ❌ error
- 未使用 transition → ℹ️ info

### L3

- action が、L2 の transition.id にも、同じ画面の L4 の画面内イベントにも一致しない → ❌ error
- `headerRight` とメニュー項目（`menu[].action`）の action も検査する

### L4

- screenKey 不一致 → ❌ error
- 画面遷移を伴うイベント（`navigate` / `navigateStack`）と L2 transition の不一致 → ℹ️ info（状態）
- `navigateStack` の steps が、L2 に存在しない画面を参照 → ❌ error
- query / mutation 未定義参照 → ❌ error
- スキーマ違反 → ❌ error（どのプロパティが問題かをメッセージに含める）

### OpenAPI

- operationId 未定義 → ❌ error
- 重複 → ❌ error
- L4 が存在しない operationId 参照 → ❌ error
- 未使用 operationId → ℹ️ info（構造進捗表示）

### i18n

- key 不存在 → ❌ error
- 未翻訳（ja以外） → ℹ️ info

---

## 🧩 画面内イベントと遷移

L4 のイベントは、画面遷移を伴うものと、伴わないもの（**画面内イベント**）に分かれる。

| type                                                                 | 種別           | L2 の transition                      |
| -------------------------------------------------------------------- | -------------- | ------------------------------------- |
| `navigate` / `navigateStack`                                         | 画面遷移       | 必要（`navigate` は L2 の遷移に対応） |
| `update` / `updateState` / `callQuery` / `callMutation` / `external` | 画面内イベント | 不要                                  |

L3 の action は、L2 の transition.id **または** 同じ画面の L4 の画面内イベントのキーと一致すればよい。

---

## 📂 推奨構成

```txt
specs/
  L2.screenflows/
  L3.ui/
  L4.state/
  i18n/
```

原則：

> 1 screen = 1 file

---

## ⚙ CLI

```bash
mobilespec check
mobilespec update
```

### check（CI / read-only）

CI では **check のみ**を実行する（ファイルを生成・更新しない）：

```bash
pnpm run sdd:check
```

error が1件でもあれば exit 1。

オプション:

- `--specs-dir <dir>` 仕様ディレクトリ
- `--schema-dir <dir>` スキーマ（既定はパッケージ同梱）
- `--openapi <path>`（`openapi-check`）カレントディレクトリ基準の相対パス。config の `openapi.path` は仕様ディレクトリ基準
- `--verbose` i18n の診断を集計せず、全件表示

出力は、error / info の件数の要約で終わる。i18n の欠落・未翻訳は locale ごとに集計して表示する。

### update（local / write）

ローカル開発では、仕様変更後に **生成物（i18n / mermaid）を更新してから検証**したい場合がある。

```bash
pnpm run sdd:update
```

`update` は i18n / mermaid を更新し、その後に `check` を実行する（副作用あり）。

---

## 🔁 CI（GitHub Actions）

利用側のリポジトリから、再利用ワークフローを呼べる：

```yaml
jobs:
  sdd:
    uses: exabugs/mobilespec/.github/workflows/sdd-check.yml@main
    with:
      specs_dir: specs/mobile
      openapi_path: docs/specs/openapi.bundled.yaml # 任意（リポジトリのルートからの相対パス）
```

公開済みの `@exabugs/mobilespec` を使う（バージョンは `mobilespec_version` で固定できる）。

---

## 🧠 SDD のゴール

- 実装は破棄可能
- フレームワーク変更可能
- AI は構造のみ読めば生成可能
- 契約違反は自動検知
- トークン消費最小

---

## 🔥 mobilespec の役割

> 構造を正とするための検証エンジン

---

## 📚 詳細ドキュメント構成

```txt
docs/
  adr/
  01_principles.md
  02_structure_model.md
  03_validation_model.md
  04_ci_policy.md
  05_lifecycle.md
  06_ai_collaboration.md
  07_configuration.md
```

README は「入口」。

詳細は docs/ 以下へ。
