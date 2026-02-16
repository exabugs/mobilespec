# Structure Model

SDDは4層構造で構成される。

---

## L2 — Screen Flow

責務：
画面遷移構造

要件：

- screen.id 一意
- contextによりvariant分離
- entryは複数可
- entryから到達不能はerror
- transition.targetContext必須（曖昧時）

---

## L3 — UI

責務：
UI構造

要件：

- L3.screenはL2.screenに存在
- actionはL2.transition.idと完全一致

---

## L4 — State / Data Contract

責務：
状態・API接続

要件：

- screenKeyはL2に存在
- eventsキーはL2.transition.idと一致
- callQuery/queryはdata.queries参照
- callMutation/mutationはdata.mutations参照

---

## OpenAPI

責務：
API契約

要件：

- operationId必須
- 一意
- L4参照operationIdは存在必須
- selectRootを記述する場合、OpenAPI schemaで証明可能であること

---

## i18n

責務：
表示契約

要件：

- titleキー存在
- component.labelキー存在
- jaは基準言語
