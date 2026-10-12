# mobilespec — AI 向けの仕様（短い規範）

この文書は、AI がモバイル仕様を**読み・書き・直す**ためのもの。人向けの説明は省いてある。`mobilespec guide` で出力できる。

## 0. 原則

- **構造が正。実装は従属する。** 仕様に無い画面・遷移・API 呼び出しを、実装で作らない
- **1 つの事実は 1 か所。** 他のレイヤーは名前で参照する。重複して書かない
- **導けるものは書かない。** 画面 ID・終端・遷移の起動のしかた・ja の文言・遷移図・索引は生成物
- 構造が矛盾していたら、推測せず、`mobilespec check --format json` の診断に従って直す

## 1. 作業の手順

```bash
mobilespec index                    # 全体を掴む（画面・遷移・API）
mobilespec context <screen-id>      # 1 画面ぶん（L2 + L3 + L4 + 前後の遷移 + API + 文言）
mobilespec new <id> --group <g>     # 新しい画面の雛形
# … 編集 …
mobilespec check --format json --screen <id>   # 検証。diagnostics の file + pointer が直す場所
mobilespec update                   # 生成物（i18n/ja.json、.mobilespec/）を更新
```

`check --format json` の診断: `code` / `file` / `pointer`（JSON ポインタ）/ `found` / `expected`（有効な候補）/ `suggest`（最も近い候補）。`suggest` があれば、その名前に直す。

## 2. 構造

```text
app.yaml                           version: 2 / groups / locales / openapi / facts
L2.screenflows/**/<id>.flow.yaml   画面間の接続（唯一の正）
L3.ui/**/<id>.ui.yaml              UI の構造
L4.state/**/<id>.state.yaml        状態・データ・画面内の振る舞い
i18n/ja.json                       生成物（手で編集しない）。他のロケールは翻訳
```

- **画面の ID はファイル名。** ファイルの中に `id` を書かない。`screen:` の包みも無い
- L3 / L4 のファイルには、同じ ID の L2 のファイルが必要

### L2（接続）

`name` / `group`（必須）、`entry`、`root`、`params`（受け取る契約）、`transitions`。説明系（`summary` `description` `notes` `links` `mockup` `status`）は人向け。

```yaml
transitions:
  - id: open_members # L3 の action / L4 の go が参照する
    target: item_members # 画面 ID。external は予約語（アプリ外）
    params: { id: $params.id } # 行き先の params への引き渡し（参照 or リテラル）
  - id: to_home
    auto: true # 条件が成立したら自動で遷移
    when: isSignedIn # 参照だけ
    target: home
  - id: to_signin
    auto: true
    else: true # 他の auto が成立しないとき（画面あたり 1 つまで）
    target: signin
```

- 複数画面にまたがる遷移は `target` の代わりに `stack: [{ navigate|push|replace: { to, params } }]`
- 遷移の起動のしかたは書かない（L3 の action / L4 の go の参照、または `auto: true`）
- 必須の `params` は、全ての遷移で渡す

### L3（UI）

```yaml
layout:
  {
    type: column,
    children:
      [{ component: Button, id: btn_join, name: 参加する, action: join, unavailable: hide }],
  }
headerRight: […]
```

- `action` は、**同じ画面の** L2 の遷移の ID（`auto` を除く）または L4 のイベントのキー
- **action を持つ部品に `visibleWhen` は書けない**（可否は遷移・イベントの `when` が持つ）。使えないときの表示は `unavailable: hide | disable`
- `visibleWhen` / `repeatFrom` は参照だけ。`props` の `$` で始まる文字列は参照

### L4（状態・データ・振る舞い）

```yaml
data:
  queries: { item: { operationId: getItem, args: { id: $params.id } } }
  mutations: { join: { operationId: joinItem, args: { id: $params.id } } }
state: [{ name: tab, type: string, enum: [info, members], default: info }]
conditions: { canJoin: { expr: '!item.isPending && isSignedIn' } }
events:
  join:
    when: canJoin # 参照だけ
    steps:
      - mutate: join
      - refetch: [item]
      - set: { tab: members }
      - go: after_join # 同じ画面の L2 の遷移を起動（行き先は L2 が持つ）
```

- ステップは 5 種: `mutate` / `refetch` / `set` / `go` / `external`。`on: enter` は画面表示時
- **遷移の行き先を L4 に書かない。** `go` で L2 の遷移 ID を参照する
- HTTP のメソッドと URL を書かない。OpenAPI の `operationId` と `args` で接続する

## 3. 参照と式

- 参照: `$params.x`（L2 の params）、`name`、`query.data` / `query.isPending` / `query.isError`、`source`、`condition`、`fact`、`.length`
- **値の位置**（`params` / `args` / `set` / `props`）: `$` で始まる文字列は参照、それ以外はリテラル
- **式**（`!` `&&` `||` `==` `!=` `<` `<=` `>` `>=`、括弧）は、**L4 の `conditions[].expr` にだけ**書ける。L2 / L3 / `when` は参照（名前）だけ。複合の条件は、L4 の `conditions` に名前を付けて参照する
- 名前（params 以外）は、画面内で一意（state / queries / mutations / sources / conditions / facts）。`params` は予約語
- 関数呼び出し・代入・ループは書けない

## 4. 型

`string` / `number` / `integer` / `boolean` / `unknown`（未定義。info）/ `[T]` / `{ a: string, b: 'number?' }` / `{ $ref: '#/components/schemas/X' }`。`enum:` で値を列挙。クエリの結果の型は OpenAPI から導く（宣言しない）。

## 5. 禁止事項

- URL・HTTP メソッドの直書き
- L4 に遷移先を書く、L2 / L3 に演算子を持つ式を書く、action 付きの部品に `visibleWhen` を書く
- `i18n/ja.json` を手で編集する（`mobilespec update` で再生成する）
- 仕様に無い画面・遷移・イベント・API 呼び出しを実装で作る
- 構造が矛盾しているときに、推測で直す（診断に従う）

## 6. 実装の範囲

実装してよい: UI を L4 の query / mutation / state に結び付ける、L3 の action からイベント・遷移を起動する、L2 の遷移を画面遷移にする。
実装してはならない: 構造の変更（遷移・イベント・クエリ・ミューテーションの追加）。必要なら、先に仕様を直す。
