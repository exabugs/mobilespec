# SDD 構造規約

## 1. SSOT 原則

- API は OpenAPI が唯一の正
- UI は L2/L3/L4 が唯一の正
- i18n はキーのみを参照

---

## 2. ファイル構成

原則：1 screen = 1 file

specs/
L2/<screen>.yaml
L3/<screen>.yaml
L4/<screen>.yaml

---

## 3. 命名規則

screen id:
^[a-z][a-z0-9_]\*$

transition id:
open_xxx
back_to_xxx
reload_xxx

operationId:
動詞 + 対象（getUser, updateVenue）

---

## 4. L4 データ契約規約

- URL/HTTP メソッド記述禁止
- operationId のみ記述可
- selectRoot を必須とする
- select で使用フィールドを明示

---

## 5. BFF API 規約

レスポンスは統一：

ApiResponse<T>:
data: T
requestId: string

---

## 6. i18n 規約

- L2/L3/L4 には key のみ記述
- 実文言は i18n/ja.yaml などへ
- 未使用 key は CI で検出
