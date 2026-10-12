# 検証モデル

error は「実装不能」のものだけ。レイヤーをまたぐ検査は、**参照する側が、参照される側を検証する**。一覧は [design/spec-redesign.md §7](design/spec-redesign.md)。

| 層   | 主な検査                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| 構造 | スキーマ違反、ID・名前の重複、L3 / L4 に対応する L2 が無い、`group` が `app.yaml` に無い                   |
| 純度 | L4 に遷移の行き先、L2 / L3 に演算子を持つ式、action 付きの部品に `visibleWhen`（正しい置き場所を案内する） |
| L2   | 起点の有無、到達可能性、`target` の存在、`params` の契約、`auto` の `when` / `else`、参照の存在            |
| L3   | `action` の解決（同じ画面の L2 の遷移か L4 のイベント）、参照の存在                                        |
| L4   | `go` の解決、`mutate` / `refetch` の対象、`operationId` と `args`（OpenAPI）、`set` の型、式の構文・循環   |
| i18n | `ja.json` が古い（error 1 件）。他のロケールの未翻訳は info                                                |
| info | 未使用の要素、`type: unknown`、散文のみの条件、説明の欠落                                                  |

診断は `code` / `level` / `file` / `pointer` / `found` / `expected` / `suggest` を持つ（`check --format json`）。

式は**解析だけ**で、実行しない（構文エラー、存在しない名前、条件の循環を検出する）。
