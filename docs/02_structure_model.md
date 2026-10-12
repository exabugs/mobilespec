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
- `root: true` の画面は、entry と同じく到達可能性の起点（タブの最上位画面など）
- transition.target の予約語 `external` は、アプリ外・SDK 管理の遷移先（画面として存在しなくてよい）
- transition.description は人間向けメモ

---

## L3 — UI

責務：
UI構造

要件：

- L3.screenはL2.screenに存在
- actionはL2.transition.id、または同じ画面のL4の画面内イベントのキーと完全一致
- `headerRight`（ヘッダー右側のコンポーネント）と `menu[].action` も対象
- `states` で画面の状態ごとの表示を説明できる
- `repeatFrom` は L4 の状態への参照（ドット区切り可）

---

## L4 — State / Data Contract

責務：
状態・API接続

要件：

- screenKeyはL2に存在
- 画面遷移を伴うイベント（navigate / navigateStack）のキーはL2.transition.idと一致（不一致は info）
- 画面内イベント（update / updateState / callQuery / callMutation / external）はL2に不要
- `navigate` は `params` で遷移先にパラメータを渡せる
- `navigateStack` は `steps`（navigate / push / replace）で複数画面をまたぐ遷移を表す。各 step の遷移先はL2に存在すること
- `updateState` は `field` で更新する状態を指定する
- `stateData` / `constants` / `onEnterEffects` で状態の初期値・定数・画面表示時の処理を書ける
- `x-` で始まるプロパティは拡張用（検証しない）
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
