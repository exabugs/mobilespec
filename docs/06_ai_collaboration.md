# AI との協働

AI は構造だけを読めば、実装できる。

- 入口: `mobilespec guide`（規範）、`mobilespec index`（全体）、`mobilespec context <id>`（1 画面）
- 既定の `context` は、人向けの散文を出さない（トークンを払わない）。必要なら `--docs`
- 検証: `mobilespec check --format json --screen <id>`。`file` + `pointer` が直す場所、`suggest` が候補
- 作成: `mobilespec new`

## AI がしてよいこと / してはならないこと

実装してよい: UI を L4 の query / mutation / state に結び付ける、L3 の action からイベント・遷移を起動する、L2 の遷移を画面遷移にする。

実装してはならない: 構造の変更（遷移・イベント・クエリ・ミューテーションの追加）。必要なら、先に仕様を直す。

構造が矛盾しているときは、推測せず診断に従う。
