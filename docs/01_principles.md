# SDD Principles

Structure-Driven Development (SDD) は、
「構造を唯一の正（SSOT）とする」開発思想である。

---

## 1. 構造が正、実装は生成物

コードは変更可能。
構造は不変。

L2 / L3 / L4 / OpenAPI が契約である。

---

## 2. 契約駆動

- API契約 → OpenAPI
- UI契約 → L2 / L3 / L4
- 表示契約 → i18n

URL直書き禁止。
HTTPメソッド直書き禁止。
operationIdのみ参照。

---

## 3. 検知は人間ではなくエンジン

契約違反はCLIが検知する。
AIは検知しない。

---

## 4. フラグで構造を歪めない

構造検証は常に厳格。

- strictモード不要
- checkSelectRoot フラグなし
- warnUnused フラグなし

---

## 5. 実装不能は即停止

実装できない構造はCIで止める。
