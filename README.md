# mobilespec

## Structure-Driven Development (SDD) 仕様エンジン

**mobilespec** は
**Structure-Driven Development（SDD／構造駆動開発）** を実践するための
UI構造仕様管理・検証・生成エンジンです。

---

# 🎯 SDD とは

SDD は、

- API構造（OpenAPI）
- 画面遷移構造（L2）
- UI構成構造（L3）
- 状態・データ契約構造（L4）

を **唯一の正（SSOT）** とし、

実装コードを生成物として扱う開発手法です。

---

# 🧠 SDD の原則

1. 構造が正、実装は生成物
2. OpenAPI は API 契約の唯一の正
3. L2/L3/L4 は UI 契約の唯一の正
4. BFF API レスポンスは統一型（例：`ApiResponse<T>`）
5. L4 は `operationId` のみ参照（URL直書き禁止）
6. i18n はキー参照のみ
7. 契約違反は CI で検知（AI不要）

---

# 📐 SDD アーキテクチャ

```
OpenAPI
   ↑
L4 (State / Data契約)
   ↑
L3 (UI構造)
   ↑
L2 (画面遷移)
```

mobilespec は L2/L3/L4 を管理します。

---

# 📂 推奨ディレクトリ構造

```
specs/
  L2/
    screen_home.yaml
  L3/
    screen_home.yaml
  L4/
    screen_home.yaml
  i18n/
    ja.yaml
    en.yaml
```

原則：

> 1 screen = 1 file

---

# 🔧 CLI

## validate

```bash
node dist/bin/cli.js validate --specs-dir ./specs
```

## mermaid

```bash
node dist/bin/cli.js mermaid --specs-dir ./specs
```

## i18n

```bash
node dist/bin/cli.js i18n --specs-dir ./specs
```

## check（CI向け推奨）

```bash
node dist/bin/cli.js check --specs-dir ./specs
```

## openapi-check（将来のoperationId整合性）

```bash
node dist/bin/cli.js openapi-check \
  --specs-dir ./specs \
  --openapi ./openapi.yaml
```

---

# 🚀 GitHub Actions（Reusable Workflow）

mobilespec は SDD チェック用の reusable workflow を提供します。

## 呼び出し側（asanowa等）

```yaml
jobs:
  sdd:
    uses: exabugs/mobilespec/.github/workflows/sdd-check.yml@v0.1.0
    with:
      specs_dir: .kiro/specs/asanowa/mobile
      openapi_path: openapi/bff.yaml
      fail_on_warnings: true
```

## 入力パラメータ

| Name             | Required | Default       | 説明                       |
| ---------------- | -------- | ------------- | -------------------------- |
| specs_dir        | ✓        | -             | L2/L3/L4 ルート            |
| schema_dir       |          | schema        | JSON schema ディレクトリ   |
| openapi_path     |          | ""            | OpenAPI パス               |
| fail_on_warnings |          | true          | 警告で失敗する             |
| upload_artifacts |          | true          | Mermaid/i18n を artifact化 |
| artifact_name    |          | sdd-generated | artifact名                 |

---

# 🔍 CI で検知されるもの

- L2 schema validation
- L3 schema validation
- L4 schema validation
- L2-L3 整合性
- L2-L4 整合性
- i18n key 整合性
- （将来）operationId 整合性

---

# 🧠 SDD のゴール

- 実装を捨てられる
- フレームワーク移行可能
- AI が構造だけ読めば生成可能
- トークン消費最小

---

# 📜 ドキュメント

- docs/SDD_PRINCIPLES.md
- docs/SDD_RULES.md
- docs/SDD_CI_POLICY.md
- docs/SDD_LIFECYCLE.md

---

# 🔥 mobilespec の役割

mobilespec は：

> SDD の公式仕様エンジン

です。

実装を正とせず、構造を正とする開発を実現します。

---

ここまでで、mobilespec は

✔ ライブラリ
→ ✔ SDD エンジン

に進化しました。

---

次は、

- asanowa 側の README に SDD 導入宣言を書く
- SDD versioning（v0.1 / v1.0 定義）を決める

どちらを進めますか？
