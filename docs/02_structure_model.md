# 構造モデル

詳細な書き方は [LLM_SPEC.md](LLM_SPEC.md)、設計の根拠は [design/spec-redesign.md](design/spec-redesign.md)。

## ファイル

```text
app.yaml                           version: 2 / groups / screenOrder / locales / openapi / facts
L2.screenflows/**/<id>.flow.yaml   画面間の接続
L3.ui/**/<id>.ui.yaml              UI の構造
L4.state/**/<id>.state.yaml        状態・データ・画面内の振る舞い
i18n/<locale>.json                 ja は生成物。他は翻訳
```

1 画面 = 3 ファイル（L2 / L3 / L4）。画面の ID はファイル名で、ファイルの中に書かない。L3 / L4 には同じ ID の L2 が必要。

## 事実の持ち主

| 事実                             | 持ち主                      | 他のレイヤーから         |
| -------------------------------- | --------------------------- | ------------------------ |
| 画面の存在、グループ、起点       | L2                          | —                        |
| 遷移の行き先、params の引き渡し  | L2                          | L3 は action、L4 は `go` |
| 遷移・イベントを可能にする条件   | L2 の `when` / L4 の `when` | 名前の参照               |
| 条件の式                         | L4 `conditions`             | 名前で参照               |
| アプリ全体の事実（権限など）     | `app.yaml` の `facts`       | 名前で参照               |
| API の呼び出し                   | L4 `data`                   | OpenAPI の `operationId` |
| 状態                             | L4 `state`                  | 名前で参照               |
| UI の構造、部品が起動する action | L3                          | —                        |
| 文言                             | `i18n/ja.json`（生成）      | キー                     |

## 縦の接続

```text
L3.action → L2.transition.id（または L4.events のキー）
L2.transition ← L4.steps.go
L4.data → OpenAPI.operationId
```

この接続がすべて成立している状態を、構造が整合している、という。
