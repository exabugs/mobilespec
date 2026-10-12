# 仕様体系の見直し — AI の効率と、人間向けドキュメントのソース（1.2.0）

- ステータス: **提案中（レビュー待ち。実装はこの文書の承認後）**
- 前提: 1.2.0 では破壊的変更を許容する（ユーザー指示）
- **mobilespec の目的は 2 つ**
  1. **AI が効率的に動作できること**
  2. **人間向けのドキュメントを生成するソースとして、効率的に使えること**
- 方針（ユーザーの判断）: **L2 / L3 / L4 のレイヤー分離を維持する。画面間の接続は L2 だけを見れば分かるようにする**
- 置き換え: 先に出した「L4 v2 設計案」「1 画面 1 ファイルへの統合案」は、この文書に統合して取り下げる
- 関連: [01_principles.md](../01_principles.md)、[LLM_SPEC.md](../LLM_SPEC.md)

---

## 1. 二つの目的が意味すること

### 目的 1: AI が効率よく動作する

| #   | 観点                       | 意味                                                                                                     |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| A1  | **読む量が少ない**         | 1 つの作業に必要な情報が、少ないファイル・少ないトークンで得られる。全体像は一覧で、詳細は必要な画面だけ |
| A2  | **推測が要らない**         | 型・式・参照が機械的に決まる。散文を読んで意図を解釈する必要がない                                       |
| A3  | **1 つの事実は 1 か所**    | 重複がなければ、片方だけ直して食い違う、が起きない。読み合わせも要らない                                 |
| A4  | **修正ループが短く、確実** | 検証の結果が機械可読で、原因の場所・期待値・修正の候補が付く。AI が自力で直せる                          |
| A5  | **手で書かないものがある** | 仕様から導けるもの（遷移図、i18n の元の文言、索引）は生成物。AI は書かず、読むだけ                       |

### 目的 2: 人間向けドキュメントを生成するソースとして使える

| #   | 観点                       | 意味                                                                                                                 |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| H1  | **必要な情報が仕様にある** | 画面の目的・説明、画面への経路、状態、使う API、文言、設計判断への参照など、ドキュメントに載せる情報が仕様の中にある |
| H2  | **構造から導ける**         | 画面一覧、遷移図、状態・条件の表、API の利用表は、手で書かず、仕様から**決定的に**生成する（同じ入力 → 同じ出力）    |
| H3  | **散文は専用の場所に**     | 人向けの説明（`summary` / `description` / `notes`）は構造と分け、AI の読み取りを増やさない                           |
| H4  | **他のツールが使える**     | 解決済みの正規化モデルを JSON で出力でき、独自の生成器・ドキュメントサイトが仕様を直接読める                         |
| H5  | **そのまま読める**         | 生成物は、そのまま人が読める（Markdown + Mermaid）。仕様のファイル自体も、整形の規則（`fmt`）で読みやすさを保つ      |

### 二つの目的の両立

AI は「少ない構造」を、人間は「豊かな説明」を求める。両立のしかた:

- **構造と散文を分ける。** 構造（型・式・参照）が検証の対象で、AI が読む。散文は `summary` / `description` / `notes` に置き、**既定では AI の入口（`index` / `context`）に出さない**（`--docs` で含める）
- **導けるものは導く。** 遷移図、一覧、利用表は、人も AI も手で書かない

---

## 2. 現状の測定（実運用のプロジェクト）

| 項目                                              | 値                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| 画面数                                            | 28                                                                  |
| L2 / L3 / L4 の大きさ（28 画面の合計）            | **L2: 13KB** / L3: 39KB / L4: 42KB                                  |
| 遷移の行き先・ID を **L2 と L4 の両方**に書く箇所 | L4 の `navigate` イベントが 57 件。L2 の transition と二重          |
| 遷移 ID が複数のファイルに重複して現れる箇所      | 117                                                                 |
| i18n（4 ロケール）                                | 63KB。仕様の約 2/3。ja は仕様から導ける                             |
| L4 が OpenAPI の `operationId` に接続している画面 | **0**（取得元を `'API: GET /…'` の散文で書いたファイルが 14）       |
| 状態・条件の記述                                  | すべて名前 → 説明文字列（型・式なし）。式に見える条件は 59 件中 13  |
| 検証                                              | 351 件のエラー。i18n の欠落が 276。診断は人向けの文章のみ、重複あり |

**L2 は、28 画面の全体で 13KB。** 画面間の接続は、L2 だけを一度に読めば、全体を把握できる。この性質（関心ごとのレイヤー分離）は活かす。

問題は、レイヤーの分け方ではなく、レイヤーの**中身**にある。

1. **A3 違反**: 遷移先は L2（transition）と L4（`navigate` イベント）の両方にある。接続の事実が 2 か所にあり、「接続は L2 を見ればよい」が、実際には守られていない
2. **A2 違反**: 状態・条件・API の取得元が散文。AI は文章を解釈して型を決める
3. **A4 違反**: 診断が人向けの文章。i18n の欠落 276 件のように、本質（`update` を実行していない、の 1 件）が埋もれる
4. **A5 違反**: i18n の ja は仕様（`name`）から導けるのに、別ファイルで保守され、欠落がエラーになる
5. **A1 の欠如**: 全体を掴む手段（索引）と、1 画面に必要な 3 層をまとめて出す手段がない

---

## 3. 設計の方針

1. **レイヤーは責務で分ける（維持）。** 各レイヤーは、自分の責務の事実だけを持つ

   | レイヤー | 責務                                 | 持つもの                                                             |
   | -------- | ------------------------------------ | -------------------------------------------------------------------- |
   | **L2**   | **画面間の接続（唯一の正）**         | 画面、遷移（行き先、きっかけ、条件、渡す `params`）、`params` の契約 |
   | **L3**   | UI の構造                            | 部品の木、文言、どの操作が何を起動するか（`action`）                 |
   | **L4**   | 画面の状態・データ・画面内の振る舞い | 状態、データ（OpenAPI）、条件、イベント                              |

2. **接続を持つのは L2 だけ。** L4 は遷移先を書かない。遷移が必要なときは、L2 の遷移を **ID で参照する**（`go`）。接続の事実は 1 か所（A3）
3. **すべてを型と式で書く。** 散文は `description` に置き、検証対象は構造にする（A2）
4. **OpenAPI の `operationId` までの接続を、書きやすく、検証できるようにする。** HTTP のメソッドとパスは仕様に書かない（A2）
5. **AI 向けの入口を用意する**: 全体の索引、**3 層を 1 画面にまとめた文脈**、機械可読な診断、修正の候補（A1, A4）
6. **生成物は手で書かない。** ja の文言、遷移図、索引、ドキュメント（A5）
7. **error は実装不能なものだけ。** 翻訳の欠落などは info（A4）
8. **人向けの説明は、構造と分けた専用のフィールドに置く。** ドキュメントの生成元として十分な情報を、仕様に持たせる（H1, H3）
9. **解決済みのモデルを、安定した形で出力する。** ドキュメント生成・他のツールが、同じモデルを読む（H2, H4）

---

## 4. 構造

現在の構造を土台に、整理する（ディレクトリ・ファイル名・`screen:` の包み方は維持）。

```text
specs/mobile/
├── app.yaml                          # アプリ全体の設定（旧 mobilespec.config.yml + L2.guards.yaml）
├── design-tokens.yaml                # 従来どおり
├── L2.screenflows/<group>/<id>.flow.yaml   # 画面間の接続（唯一の正）
├── L3.ui/<group>/<id>.ui.yaml              # UI の構造
├── L4.state/<group>/<id>.state.yaml        # 状態・データ・画面内の振る舞い
├── i18n/
│   ├── ja.json                       # 生成物（仕様の name / label から。手で編集しない）
│   └── <locale>.json                 # 翻訳（ja のキーに対応。欠落は info）
└── .mobilespec/                      # 生成物（索引、遷移図）
```

### 4.1 `app.yaml`

```yaml
version: 2 # 仕様の書式のバージョン
groups: [home, item, misc] # 画面のグループ（遷移図・索引の並び）
locales: [ja, en] # ja は仕様から生成する元
openapi: ../../docs/specs/openapi.bundled.yaml # app.yaml からの相対パス
facts: # アプリ全体の事実（画面の状態では決まらない真偽値）。実装側が提供する
  isSignedIn: { description: サインイン済み }
  isGpsGranted: { description: 位置情報の権限が許可されている }
```

`facts` は、L2 の `when` と、L4 の `conditions` の式から参照できる（旧 L2 の guard）。

### 4.2 L2 — 画面間の接続

```yaml
screen:
  id: item_detail
  name: 項目の詳細 # 画面タイトル（ja。i18n の元）
  type: screen # screen | choice（choice は表示せず、条件で自動分岐する）
  entry: false # アプリの起点
  root: false # タブの最上位など、直接到達できる画面
  status: stable # draft | stable | deprecated（ドキュメントに表示）
  summary: 項目の詳細と、参加の操作 # 1 行の要約（一覧・索引に出る）
  description: | # 人向けの説明（ドキュメント用。AI の既定の入口には出ない）
    項目の詳細を見せる。サインイン済みで、まだメンバーでない人には「参加する」を出す。
  notes: [参加の取り消しは、メンバー一覧の画面から行う] # 補足・既知の制約（ドキュメント用）
  links: [{ label: 設計メモ, href: ../../../docs/design.md#item }] # 設計書・ADR への参照
  mockup: ./mockups/item_detail.png # 画面の見本の画像（任意）

  params: # この画面が受け取るパラメータ（接続の契約）
    - { name: id, type: string, required: true, description: 項目の ID }

  transitions:
    - id: open_members
      trigger: tap # tap: UI の操作で起動 / event: L4 の go で起動 / auto: 自動
      target: item_members
      params: { id: $params.id } # 行き先の params への引き渡し（式）
    - id: after_join
      trigger: event
      target: item_members
      params: { id: $params.id }
      description: 参加の完了後、メンバー一覧へ
    - id: open_share
      trigger: tap
      target: external # 予約語: アプリ外・SDK 管理の遷移先
```

- 遷移の `target` + `params` が**接続のすべて**。L2 を読めば、どの画面から、どの画面へ、何を渡して行くかが分かる
- `trigger: tap` は、L3 の `action` が直接起動する。`trigger: event` は、L4 のイベントが `go` で起動する（振る舞いのあとに遷移するとき）。`trigger: auto` は自動（`type: choice` の分岐など）
- `when`: 遷移できる条件（式）。`facts`・`$params`・**同じ画面の L4 の `conditions` / `state`** の名前を参照できる。`else: true` は、`choice` 画面で他の `auto` が成立しないときの分岐
- 複数画面にまたがる遷移（旧 `navigateStack`）は、`target` の代わりに `stack:`（`navigate` / `push` / `replace` のステップの列）を書く

### 4.3 L3 — UI の構造

```yaml
screen:
  id: item_detail
  layout:
    type: column
    children:
      - { component: Button, id: btn_members, name: メンバーを見る, action: open_members }
      - { component: Button, id: btn_join, name: 参加する, action: join, visibleWhen: canJoin }
      - { component: List, id: list_members, name: メンバー, repeatFrom: item.data.members }
  headerRight:
    - component: IconButton
      id: btn_more
      name: メニュー
      menu: [{ id: menu_share, label: 共有, action: open_share }]
```

- `action` は、**同じ画面の** L2 の `trigger: tap` の遷移の ID、または同じ画面の L4 のイベントのキーと一致すること（全画面の集合ではなく、画面単位で検証する）
- `visibleWhen` / `repeatFrom` / `props` の値は式。参照（L4 の `state` / `conditions` / `data` など）を検証する
- 文言は `name`（部品名）と `label`（メニュー項目）。ja の元。i18n のキーはこれらから導く

### 4.4 L4 — 状態・データ・画面内の振る舞い

```yaml
screen:
  id: item_detail

  data: # OpenAPI に接続するデータ
    queries:
      item: { operationId: getItem, args: { id: $params.id } }
      myStatus: { operationId: getMyStatus, args: { id: $params.id } }
    mutations:
      join: { operationId: joinItem, args: { id: $params.id }, options: { idempotent: true } }

  sources: # API 以外のデータ源
    heading: { kind: device, type: number, description: 端末の向き（度） }

  state: # 画面ローカルの状態
    - { name: tab, type: string, enum: [info, members], default: info }

  conditions: # 名前付きの式
    isLoading: { expr: item.isPending }
    canJoin:
      expr: '!myStatus.data && !item.isPending && isSignedIn'
      description: メンバーでなく、取得済み、サインイン済み

  events: # 画面内の振る舞い（遷移の行き先は書かない）
    join:
      when: canJoin
      steps:
        - mutate: join
        - refetch: [myStatus]
        - set: { tab: members }
        - go: after_join # L2 の遷移（trigger: event）を起動する
```

**イベントは「ステップの列」。** 順に実行する。ステップの種類は 5 つだけ。

| ステップ                        | 内容                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `mutate: <mutation のキー>`     | `data.mutations` の呼び出し。失敗したら以降を実行せず、`onError` があればそれを実行                     |
| `refetch: [<query のキー>]`     | `data.queries` の再取得                                                                                 |
| `set: { <state の名前>: <式> }` | 状態の更新                                                                                              |
| `go: <L2 の遷移 ID>`            | 同じ画面の L2 の遷移（`trigger: event`）を起動する。**行き先・`params` は L2 が持つ。ここには書かない** |
| `external: <説明>`              | 外部（SDK・OS）に処理を委ねる                                                                           |

イベントのその他のキー: `when`（実行できる条件。式）、`on`（`ui`（既定。L3 の `action` が起動）/ `enter`（画面表示時））、`onError`（`mutate` が失敗したときのステップの列）、`description`。

> 旧体系との対応: L4 の `navigate` イベント（L2 の transition と二重だった）→ 廃止。遷移だけの操作は L2 の `trigger: tap` の遷移だけ。振る舞いのあとに遷移する操作は、L4 のイベント + `go` + L2 の `trigger: event` の遷移。`update` / `callMutation` / `callQuery` / `updateState` / `external` → ステップ。`onEnterEffects` → `on: enter` のイベント。`navigateStack` → L2 の `stack`。

### 4.5 型と式

**型**: `string` / `number` / `boolean` / `{ a: string, b: number? }`（`?` は省略可）/ `[string]` / `$ref: '#/components/schemas/X'`（OpenAPI）/ `unknown`（未定義。info）。`enum:` で値を列挙。クエリの結果の型は OpenAPI の応答スキーマから導く（宣言しない）。

**式**: 実行しない。構文を解析し、参照を検証するだけ（任意コードの実行はしない）。

- 参照: `$params.x`、`state の名前`、`query の名前.data`（`.isPending` / `.isError`）、`source の名前`、`facts の名前`、`conditions の名前`、ドット区切り、`.length`
- 演算: `!` `&&` `||` `==` `!=` `<` `<=` `>` `>=`、括弧、リテラル（文字列・数値・真偽値・`null`）

関数呼び出し、代入、ループは書けない。足りないときは `description` に散文で書く。

**説明（`description`）**: `params` / `state` / `conditions` / `data` の各項目、遷移、イベント、`facts` は、`description`（人向けの 1 文）を持てる。ドキュメントの表の「説明」列になる。構造の検証には使わない。

---

## 5. 導出されるもの（手で書かない）

| 生成物                 | 内容                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 遷移グラフ             | **L2 だけから**導く（L4 は接続を持たない）。到達可能性の検査、遷移図（Mermaid）、索引に使う                                                                     |
| `i18n/ja.json`         | `name` / `label` / 画面の `name` から。`update` で再生成。`check` は、ja.json が仕様と食い違っていたら **1 件の error**（「`mobilespec update` を実行」）にする |
| `.mobilespec/index.md` | 全体の索引（§6.2）。`update` で再生成                                                                                                                           |
| `.mobilespec/flows.md` | 遷移図（従来の `flows.md`）                                                                                                                                     |
| 人間向けドキュメント   | `mobilespec docs` が生成（§6.5）。画面ごとのページ、一覧、利用表など                                                                                            |
| 正規化モデル（JSON）   | `mobilespec export` が出力（§6.5）。他のツールの入力                                                                                                            |

---

## 6. AI 向けの入口と、人間向けドキュメントの生成（CLI）

### 6.1 機械可読な診断（A4）

```bash
mobilespec check --format json [--screen <id>]
```

```json
{
  "ok": false,
  "errors": 1,
  "diagnostics": [
    {
      "code": "UNKNOWN_REFERENCE",
      "level": "error",
      "file": "L4.state/item/item_detail.state.yaml",
      "pointer": "/screen/events/join/when",
      "message": "式が参照する名前 \"canJoinn\" が存在しません",
      "found": "canJoinn",
      "expected": ["canJoin", "isLoading"],
      "suggest": "canJoin"
    }
  ]
}
```

- `code` は安定した識別子。`file` + `pointer`（JSON ポインタ）で、直す場所が確定する
- `expected` に有効な候補、`suggest` に最も近い候補（綴りの近さ）を入れる
- `--screen` で 1 画面だけを検証する（修正ループを速くする）
- 既定の出力（人向けのテキスト）は、i18n を集計し、件数の要約で終わる（現行どおり）

### 6.2 全体の索引（A1）

```bash
mobilespec index        # .mobilespec/index.md を生成。標準出力にも出せる
```

AI が最初に読む 1 枚。画面の一覧（id、name、summary、group、起点・root、遷移先、使う `operationId`）と、遷移の辺。**全体像を、画面ファイルを開かずに把握する**。接続だけなら、L2 を直接読んでもよい。

### 6.3 画面の文脈（A1）

```bash
mobilespec context <screen-id>
```

**3 層を、1 画面ぶんにまとめて**、解決済みで出す。

- L2 / L3 / L4 のその画面の仕様
- この画面への遷移（他の画面の L2 から。誰が、どの `params` で来るか）
- 使う `operationId` の入出力の型（OpenAPI から。URL・HTTP メソッドは出さない）
- 参照する `facts` の説明
- ja の文言（画面のタイトルと部品名）

AI は、`index`（または L2）で全体を掴み、`context` で 1 画面を掴み、その画面のレイヤーのファイルだけを編集する。

### 6.4 その他

| コマンド                             | 内容                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `mobilespec new <id> --group <g>`    | 最小の有効な画面ファイル（L2 / L3 / L4）を作る（書式を暗記しなくてよい）                                           |
| `mobilespec guide`                   | AI 向けの短い仕様（`docs/LLM_SPEC.md`）をパッケージから出す                                                        |
| `mobilespec fmt [--check]`           | 仕様ファイルを正規の形に整形する（キーの順序、ブロック形式）。書き方の揺れによる差分をなくし、人にも読みやすく保つ |
| `mobilespec update [--check]`        | 生成物（ja.json、索引、遷移図）を更新。`--check` は更新が必要かの検査のみ（CI 向け）                               |
| `mobilespec migrate`                 | 旧体系 → 新体系（§8）                                                                                              |
| `mobilespec check` / `openapi-check` | 従来どおり（`openapi-check` は `check` に統合する。`app.yaml` の `openapi` を使う）                                |

スキーマ（`schema/*.json`）は、エディタ・AI のための補完の元として配る。

### 6.5 人間向けドキュメントの生成（H1〜H5）

```bash
mobilespec docs --out docs/generated      # Markdown（+ Mermaid）を生成
mobilespec export --format json           # 解決済みの正規化モデルを出力
```

**`docs` が生成するもの（決定的。同じ仕様 → 同じ出力）**

| ページ            | 内容                                                                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.md`        | アプリの概要。グループごとの画面一覧（`name` / `summary` / `status`）、全体の遷移図                                                                                                                                                                                                                                 |
| `screens/<id>.md` | 画面 1 つ分: 概要（`summary` / `description` / `notes` / `links` / `mockup`）、**この画面への経路**、この画面からの遷移、パラメータの表、状態・条件の表、データ（使う API。OpenAPI の `summary` / `description` を引く）、イベントの表（きっかけ・条件・ステップ）、UI の構成（部品の木）、文言の一覧、画面の遷移図 |
| `api-usage.md`    | `operationId` × 画面の利用表。使われていない API も一覧にする                                                                                                                                                                                                                                                       |
| `facts.md`        | アプリ全体の事実（`facts`）と、それを使う画面                                                                                                                                                                                                                                                                       |
| `i18n.md`         | ロケールごとの翻訳の進捗（欠落・未翻訳の件数と一覧）                                                                                                                                                                                                                                                                |

- 出力は Markdown と Mermaid。GitHub / VS Code などで、そのまま読める
- **決定的**: 並び順は仕様の順序（`app.yaml` の `groups` など）。生成日時などの揺れる情報は入れない → 差分がレビューできる。CI で `docs --check`（生成物が最新か）を検査できる
- 説明が空の項目は、ページに「未記入」と出す（情報の欠落を、人が気づける）。`check` では info

**`export`（正規化モデル）**: すべての画面、L2 から導いた遷移グラフ、参照を解決した `data`（OpenAPI の情報を含む）、型、`facts` を、1 つの JSON にして出す。形は安定させ、スキーマを配る。独自の生成器、ドキュメントサイト、画面のカタログが、仕様を直接読める。

> HTML や PDF の出力、テンプレートの差し替え（`--template`）は、Markdown と `export` を土台にして、必要になったら追加する（初版の範囲外）。

---

## 7. 検証

error は「実装不能」のものだけ。**レイヤーをまたぐ検査は、参照する側が、参照される側を検証する。**

| 検査                                                                                                   | レベル                                 |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| スキーマ違反（プロパティ名・許可される値を含む）                                                       | error                                  |
| **L2**: `entry` が 0 件、`entry` / `root` から到達不能な画面（予約語 `external` を除く）               | error                                  |
| **L2**: `target` が存在しない画面。`params` が行き先の `params` と食い違う（必須の欠落・未知）         | error                                  |
| **L2**: `type: choice` の `auto` に `when` も `else` も無い、`else` が複数                             | error                                  |
| **L2**: `when` の式の構文エラー、存在しない名前の参照（`facts` / `$params` / 同じ画面の L4）           | error                                  |
| **L3**: 画面が L2 に存在しない                                                                         | error                                  |
| **L3**: `action` が、同じ画面の L2 の `trigger: tap` の遷移にも、L4 のイベントにも無い                 | error                                  |
| **L3**: `visibleWhen` / `repeatFrom` / `props` の式が、存在しない名前を参照                            | error                                  |
| **L4**: 画面が L2 に存在しない。`go` の ID が、同じ画面の L2 の `trigger: event` の遷移に無い          | error                                  |
| **L4**: `mutate` / `refetch` が、存在しない `data` のキーを参照。`operationId` が OpenAPI に無い       | error                                  |
| **L4**: `args` が OpenAPI の引数と食い違う（必須の欠落・未知）                                         | error                                  |
| **L4**: `set` の対象が `state` に無い、型が明らかに不一致。式の構文エラー・存在しない名前の参照        | error                                  |
| `ja.json` が仕様と食い違う（古い）                                                                     | error（1 件。`update` を促す）         |
| 他のロケールの翻訳の欠落・未翻訳                                                                       | info（集計）                           |
| `trigger: event` の遷移を、どの `go` も起動しない。`trigger: tap` の遷移を、どの `action` も参照しない | info                                   |
| `type: unknown`、未使用の state / query / condition / event / fact                                     | info                                   |
| 説明や文字列に HTTP メソッド + パスが書かれている                                                      | info（構造に直すよう促す）             |
| 画面の `summary` / `description` が空。各項目の `description` が空                                     | info（ドキュメントに「未記入」と出る） |
| `mockup` のファイルが存在しない。`links` の相対パスが存在しない                                        | info                                   |

---

## 8. 移行

```bash
mobilespec migrate --specs-dir <specs-dir> [--openapi <path>]            # 既定は dry-run
mobilespec migrate --specs-dir <specs-dir> [--openapi <path>] --write    # 書き換える
```

ディレクトリ・ファイル名・`screen:` の包みは**変わらない**ので、差分はファイルの中身だけ。

- **L2**: `guard`（名前）→ `when`（式）。`L2.guards.yaml` → `app.yaml` の `facts`。L4 の `navigate` イベントの `params` を、同じ ID の L2 の遷移の `params` に移す。画面の `params`（L4 の遷移先の `params` の使われ方から推定）を宣言。`navigateStack` → L2 の `stack`
- **L4**: `navigate` イベントを**削除**する（L2 に移し済み）。振る舞いのあとに遷移していたものは、`go` と、L2 の `trigger: event` の遷移にする。`update` / `callMutation` / `callQuery` / `updateState` / `external` → `steps`
- `state` / `stateData` / `dataSource` / `conditions`（散文）→ 型付きの `state` / `conditions`。型や式を決められないものは `unknown` / `description` のみとし、**散文は失わない**。件数は info に出る
- `'API: GET /items/{id}'` のような取得元は、OpenAPI を引いて `operationId` を特定し、`data.queries` にする。特定できなければ TODO
- `update` イベントで、`description` に API 呼び出しがあるものは、`mutate` ステップにする（特定できなければ TODO）
- 未知のキー（`bleFlow` など）→ `x-<キー>`（拡張。検証しない）
- 旧 i18n は、ja を捨て（仕様から再生成）、他のロケールはそのまま移す
- 変換後に `check` を実行し、結果と TODO の一覧を出す。変換は情報を失わない

先行して取り込んだ構造（1.2 のスキーマ拡張: `navigateStack`、`updateState`、`external`、`root`、`headerRight` など）は、新体系の語彙に統合する。

---

## 9. 互換性と版

- 旧体系の書式（L4 の `type` ベースのイベント、`guard` の名前など）の検証は、1.2.0 で**削除する**。旧体系の仕様は `migrate` で移行する
- **注意（版の指定）**: 実運用の利用側（複数のプロジェクト）は `^1.1.8` で使っている。`^1.1.8` は 1.2.0 に解決されるため、ロックファイルを更新すると、旧体系の仕様の CI が壊れる（今も、旧体系の仕様は検証を通っていないが）。1.2.0 を公開する前に、利用側を `~1.1.8` に固定するか、版を 2.0.0 にする
- 公開（タグ付け）は、移行の動作確認が終わってから、別途承認を得て行う

---

## 10. 実装の段階（承認後）

| 段階 | 内容                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------- |
| 1    | `app.yaml`、新しい L2 / L3 / L4 のスキーマ。式のパーサと型                                                          |
| 2    | 検証（§7）。診断の JSON 出力と `suggest`                                                                            |
| 3    | 導出（L2 の遷移グラフ、到達可能性）。`update`（ja.json、索引、遷移図）、`update --check`                            |
| 4    | OpenAPI との整合（`args`、型の導出）。`openapi-check` の統合                                                        |
| 5    | AI 向けコマンド: `index`、`context`、`new`、`guide`                                                                 |
| 6    | `migrate`。架空の旧体系の例でテスト                                                                                 |
| 7    | 実運用の旧体系の仕様で `migrate` を試験（**読み取り専用。元には書かない**）し、変換の精度と、読み取り量の削減を測る |
| 8    | 人間向けドキュメントの生成: `export`（正規化モデル）、`docs`（Markdown + Mermaid）、`docs --check`、`fmt`           |
| 9    | ドキュメント（構造モデル、検証モデル、LLM_SPEC、README）、ADR、CHANGELOG                                            |
| 10   | 公開の判断（**タグ付けは別途承認**）                                                                                |

旧体系の検証コードは、段階 6 で `migrate` が使う読み込み部分を除いて削除する。

効果の測定（段階 7）: 接続の把握に AI が読むバイト数（L2 のみ）、同じ画面を実装するのに読むバイト数（旧: 3 ファイル + 補助 / 新: `context`）、`check` の修正ループの回数、`migrate` の自動変換率。ドキュメントは、実運用の仕様から `docs` で生成して、画面ページを人が読んで確認する（情報が足りているか、読みやすいか）。

---

## 11. 決めたことと、確認したいこと

### 決めたこと

| 項目               | 決定                                                                                                                                | 理由                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| レイヤー           | **L2 / L3 / L4 の分離を維持**（ユーザーの判断）                                                                                     | 関心ごとの分離。接続は L2 だけで把握できる（L2 は全体で 13KB）        |
| 接続の持ち主       | **L2 だけ**。L4 は遷移先を書かず、`go` で L2 の遷移を参照                                                                           | A3（遷移先・ID の二重記述をなくす）。「接続は L2 を見ればよい」を守る |
| イベント           | `steps` の列、ステップは 5 種                                                                                                       | A2。散文の `update` をなくす                                          |
| 条件の指定         | `guard`（名前）→ `when`（式）                                                                                                       | A2。名前の二重管理（L2 の guard と L4 の condition）をなくす          |
| 式言語             | 自前の小さな部分集合                                                                                                                | 依存を増やさない。足りなければ CEL に移行                             |
| 旧体系との共存     | しない（1.2.0 で削除。`migrate` で移行）                                                                                            | 破壊的変更を許容する指示。二重の保守を避ける                          |
| i18n               | ja は生成物。ja の食い違いは 1 件の error。他ロケールの欠落は info                                                                  | A5、「実装不能」だけを error にする方針                               |
| `sources` の初版   | `device` / `storage`                                                                                                                | 先行例がない。使いながら足す                                          |
| 診断               | JSON 出力（`code` / `file` / `pointer` / `expected` / `suggest`）                                                                   | A4                                                                    |
| 人向けの説明       | `summary` / `description` / `notes` / `links` / `mockup` / `status` を構造と分けて置く（L2 の画面に）。既定では AI の入口に出さない | H1, H3（AI のトークンを増やさない）                                   |
| ドキュメントの形式 | 初版は Markdown + Mermaid（決定的）と、正規化モデルの JSON                                                                          | H2, H4, H5。HTML・テンプレートは後から追加できる                      |
| 整形               | `fmt` で正規の形に揃える                                                                                                            | H5。AI の書き方の揺れによる差分をなくす                               |
| 名前の維持         | ディレクトリ・ファイル名・`screen:` の包み・`trigger` / `target` / `type` は維持                                                    | 移行の差分を小さくする                                                |

### 確認したいこと

1. **版**: 1.2.0 で公開してよいか（利用側を `~1.1.8` に固定する前提）。それとも 2.0.0 にするか
2. **`go` による接続の参照**（§4.4）: 振る舞いのあとに遷移するとき、L4 のイベントが `go: <L2 の遷移 ID>` で L2 の遷移を起動する、でよいか。実運用の 90 イベント（navigate 57 / update 29 / navigateStack 2 / updateState 1 / external 1）は、すべて表現できる見込み
3. **AI 向けコマンド**（§6.1〜6.4）の範囲。特に `context`（3 層を 1 画面にまとめた文脈）を最優先で作る想定でよいか
4. **ドキュメントの出力**（§6.5）: 初版は Markdown + Mermaid と JSON でよいか。**主な読者**（開発者、デザイナー、企画、外部の関係者など）と、望む形式（社内 wiki、静的サイト、PDF など）があれば、ページの構成を合わせる
5. 人向けの説明（`summary` / `description` など）の**記入を必須にするか**。今の案は info（未記入と表示するだけ）。必須（error）にすると、仕様の記入が強制される
