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
- schema違反

---

## infoになる例

- 未使用transition
- 未使用operationId
- 未翻訳キー

---

## 重要

検証は途中で停止しない。
全検査を実行し、最後にerrorがあればexit 1。
