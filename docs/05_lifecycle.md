# SDD Lifecycle

---

## 1. 体験設計（人間）

- 画面構造設計
- 遷移設計
- 状態設計

---

## 2. 構造記述

- L2記述
- L3記述
- L4記述
- OpenAPI更新

---

## 3. 構造更新（ローカル）

仕様追加後、i18n / mermaid などの生成物を更新する：

mobilespec update

---

## 4. 構造検証（CI / read-only）

mobilespec check

---

## 5. 実装生成

AI / Generatorにより生成

---

## 6. 実装修正

構造を修正する。
コードを直接修正しない。
