# mobilespec

## Structure-Driven Development (SDD) 公式仕様エンジン

mobilespec は **Structure-Driven Development（SDD／構造駆動開発）** を実践するための仕様管理エンジンです。

SDD では、

- API構造（OpenAPI）
- 画面遷移構造（L2）
- 画面構成構造（L3）
- 状態・データ契約構造（L4）

を **唯一の正（SSOT）** とし、

実装コードは生成物として扱います。

---

## 🎯 SDD の原則

1. **構造が正、実装は生成物**
2. API 契約は OpenAPI が唯一の正
3. UI 契約は L2/L3/L4 が唯一の正
4. BFF レスポンス型は統一（例：`ApiResponse<T>`）
5. L4 は `operationId` のみ参照（URL/HTTP直書き禁止）
6. i18n はキー参照のみ（文言は辞書へ）
7. 契約違反は CI で失敗（AI 不要）

---

## 📐 SDD アーキテクチャ

```
OpenAPI  ← API契約
   ↑
L4 (State/Data契約)
   ↑
L3 (UI構成)
   ↑
L2 (画面遷移)
```

mobilespec は L2/L3/L4 を管理します。

---

## 📂 ディレクトリ構造（推奨）

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

原則：**1 screen = 1 file**

---

## L2: 画面遷移構造

目的：アプリの遷移グラフを定義

- screen id
- transition id
- entry/exit

Mermaid 図を自動生成可能。

---

## L3: UI構成構造

目的：画面の構造（Widget tree / Component tree）

- 要素定義
- action → L2 transition id 参照

---

## L4: 状態・データ契約構造

目的：画面の状態と API 接続を宣言的に定義

### 特徴

- OpenAPI `operationId` のみ参照
- レスポンス型は BFF で統一
- HTTP情報は一切書かない

例:

```yaml
data:
  queries:
    venues:
      operationId: getVenues
      selectRoot: $.data
```

---

## 🔍 バリデーション

- JSON Schema 検証
- L2-L3 整合性
- L2-L4 整合性
- i18n key 存在チェック
- operationId 存在チェック（OpenAPI連携予定）

---

## 🔄 運用フロー（SDD）

### 変更時

1. OpenAPI 更新（API変更時）
2. L2/L3/L4 更新
3. validate
4. mermaid 生成
5. 実装生成
6. CIで検知

---

## 🧠 SDD のゴール

- Flutter → ReactNative へ移行可能
- 実装を捨てられる
- AI が構造だけを読めば実装可能
- トークン消費最小

---

# 📌 追加で生成すべき重要ドキュメント

README だけでは弱いです。

以下を追加すると SDD が完成します。

---

## 1️⃣ docs/SDD_PRINCIPLES.md

内容：

- なぜ SDD か
- なぜ OpenAPI だけでは不十分か
- なぜ L2/L3/L4 を分離するか
- AI 時代に必要な設計原則

---

## 2️⃣ docs/SDD_RULES.md

機械的ルール：

- 1 screen 1 file
- 命名規則
- operationId 命名規則
- BFFレスポンス統一規約
- i18n key 規約

---

## 3️⃣ docs/SDD_CI_POLICY.md

CI で落とすもの：

- スキーマ違反
- 遷移未定義
- i18n key 不在
- operationId 不在
- 未使用 screen

---

## 4️⃣ docs/SDD_LIFECYCLE.md

開発フロー：

```
構造変更
↓
validate
↓
生成
↓
実装
↓
CI
```

---

# 🚀 次にやるべきこと

一番重要なのは：

> SDD を asanowa のルートに明文化する

mobilespec を「ライブラリ」から
「SDD 公式エンジン」に格上げする。

---

もしよければ次は：

- SDD の正式マニフェスト（1ページ宣言）
- asanowa 用の SDD 導入手順書

どちらから作りますか？
