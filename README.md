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
4. L4 は `operationId` のみ参照（URL直書き禁止）
5. i18n はキー参照のみ
6. 契約違反は CLI / CI で検知（AI不要）
7. AI は生成担当、検知はコマンドで担保

---

# 🔗 SDD 接続ルール（正式仕様）

## 1️⃣ L3 → L2

- `L3.action`
- `L2.transitions[].id`

は **完全一致**

違反 → ❌ error

---

## 2️⃣ L2 → L4

- `L4.events` のキー
- `L2.transitions[].id`

は **完全一致**

違反 → ⚠️ warning（将来 strict で error）

---

## 3️⃣ L4 内部接続

- `callQuery.query`
  → `L4.data.queries` のキー参照
- `callMutation.mutation`
  → `L4.data.mutations` のキー参照

未定義参照 → ⚠️ warning

---

## 4️⃣ L4 → OpenAPI（契約整合）

- `L4.data.*.*.operationId`
  → OpenAPI `operationId`

存在しない → ❌ error
OpenAPI未参照 → ⚠️ warning（strict で error）

---

# 📐 全体接続構造

```
L3 (UI action)
      ↓
L2 (transition.id)
      ↓
L4 (events key)
      ↓
L4.data (query/mutation key)
      ↓
OpenAPI.operationId
```

この縦接続が成立している状態を
**構造整合（Structural Integrity）** と呼ぶ。

---

# 📂 推奨ディレクトリ構造

```
specs/
  L2.screenflows/
  L3.ui/
  L4.state/
  i18n/
```

原則：

> 1 screen = 1 file

---

# 🔧 CLI

## 通常開発

```bash
pnpm run sdd:check
pnpm run sdd:openapi
```

## 締め（CI / リリース前）

```bash
pnpm run sdd:openapi:strict
```

---

# 🔍 CLI が検知するもの

### validate / check

- L2 schema validation
- L3 schema validation
- L4 schema validation
- L2-L3 整合性（error）
- L2-L4 整合性（warning）
- L4内部整合（warning）

### openapi-check

- operationId 未定義（error）
- operationId 重複（error）
- L4 が存在しない operationId 参照（error）
- OpenAPI 未参照 operationId（warning / strictでerror）

---

# 🚀 GitHub Actions（Reusable Workflow）

```yaml
jobs:
  sdd:
    uses: exabugs/mobilespec/.github/workflows/sdd-check.yml@v0.1.0
    with:
      specs_dir: specs/mobile
      openapi_path: docs/specs/openapi.bundled.yaml
      fail_on_warnings: false
```

---

# 🧠 SDD のゴール

- 実装を捨てられる
- フレームワーク移行可能
- AI が構造だけ読めば生成可能
- トークン消費最小
- 契約違反は自動検知

---

# 🔥 mobilespec の役割

mobilespec は

> SDD の構造検証エンジン

です。

コードを正とせず、
**構造を正とする開発**を実現します。

---

## ✅ 現在の成熟度

- L2/L3/L4 整合検証
- operationId 契約整合
- strict モード
- CI 統合
- 生成物（Mermaid / i18n）出力

---

次の進化としては、

- strict モードを「events 起点参照のみ」に高度化
- SDD Versioning（0.x → 1.0）定義

どちらに進めますか？
