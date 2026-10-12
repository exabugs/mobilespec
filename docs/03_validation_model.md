# Validation Model

mobilespecは2段階のみ採用する。

| level | 意味                |
| ----- | ------------------- |
| error | 実装不能（CI fail） |
| info  | 状態可視化          |

warningは存在しない。

---

## errorになる例

- 到達不能screen
- 不存在screen参照
- 不存在transition参照
- 不存在operationId参照
- selectRoot不正
- i18n key欠落
- schema違反（問題のプロパティ名をメッセージに含める）
- navigateStackの遷移先がL2に存在しない

---

## infoになる例

- 未使用transition
- 画面遷移を伴うイベントとL2 transitionの不一致
- 未使用operationId
- 未翻訳キー

---

## 重要

検証は途中で停止しない。
全検査を実行し、最後にerrorがあればexit 1。

---

## 出力

- error / info の件数の要約で終わる
- i18n の欠落（error）・未翻訳（info）は locale ごとに集計して表示する（`--verbose` で全件）
- 同じ内容の診断は 1 件にまとめる
