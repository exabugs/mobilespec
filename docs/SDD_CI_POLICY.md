# SDD CI ポリシー

CI で以下を必ず検知する。

---

## 1. スキーマ検証

- L2 schema validation
- L3 schema validation
- L4 schema validation

---

## 2. クロス整合性

- L3 action → L2 transition 存在確認
- L4 screen id → L2 screen 存在確認
- L4 event → L2 transition 存在確認
- operationId → OpenAPI 存在確認

---

## 3. i18n 整合性

- key 存在確認
- 未使用 key 検出

---

## 4. API 契約検知

- BFF request validation
- BFF response validation
- OpenAPI 変更差分チェック

---

## 5. Mermaid 生成

- L2 → Mermaid 自動生成
- 差分をレビュー可能にする
