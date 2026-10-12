# 仕様体系の全面見直し — AI が効率よく動作するために（1.2.0）

- ステータス: **提案中（レビュー待ち。実装はこの文書の承認後）**
- 前提: 1.2.0 では破壊的変更を許容する（ユーザー指示）。主目的は **AI が効率よく動作できること**
- 置き換え: 先に出した「L4 v2 設計案」（L4 だけの見直し）は、この文書に統合して取り下げる
- 関連: [01_principles.md](../01_principles.md)、[LLM_SPEC.md](../LLM_SPEC.md)

---

## 1. 「AI が効率よく動作する」とは

| #   | 観点                       | 意味                                                                                                     |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| A1  | **読む量が少ない**         | 1 つの作業に必要な情報が、少ないファイル・少ないトークンで得られる。全体像は一覧で、詳細は必要な画面だけ |
| A2  | **推測が要らない**         | 型・式・参照が機械的に決まる。散文を読んで意図を解釈する必要がない                                       |
| A3  | **1 つの事実は 1 か所**    | 重複がなければ、片方だけ直して食い違う、が起きない。読み合わせも要らない                                 |
| A4  | **修正ループが短く、確実** | 検証の結果が機械可読で、原因の場所・期待値・修正の候補が付く。AI が自力で直せる                          |
| A5  | **手で書かないものがある** | 仕様から導けるもの（遷移図、i18n の元の文言、索引）は生成物。AI は書かず、読むだけ                       |

---

## 2. 現状の測定（実運用のプロジェクト）

| 項目                                              | 値                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| 画面数                                            | 28                                                                  |
| L2/L3/L4 のファイル数                             | 86（1 画面 = 3 ファイル + 共通の補助ファイル）                      |
| 1 画面あたりの仕様の大きさ（3 ファイルの合計）    | 平均 3.3KB、最大 9.4KB                                              |
| 遷移 ID が複数のファイルに重複して現れる箇所      | **117**                                                             |
| i18n（4 ロケール）                                | 63KB。仕様の全体（L2+L3+L4 = 95KB）の約 2/3。ja は仕様から導ける    |
| L4 が OpenAPI の `operationId` に接続している画面 | **0**（取得元を `'API: GET /…'` の散文で書いたファイルが 14）       |
| 状態・条件の記述                                  | すべて名前 → 説明文字列（型・式なし）。式に見える条件は 59 件中 13  |
| 検証                                              | 351 件のエラー。i18n の欠落が 276。診断は人向けの文章のみ、重複あり |

読み取りの無駄は、構造に由来している。

1. **A1 違反**: 画面を 1 つ実装するのに 3 ファイルを開き、遷移 ID を突き合わせる。全体像を得る手段がなく、全ファイルを読むしかない
2. **A3 違反**: 画面遷移は、L2（遷移）と L4（`navigate` イベント）の両方に、遷移先・ID を書く。食い違いの温床
3. **A2 違反**: 状態・条件・API の取得元が散文。AI は文章を解釈して型を決める
4. **A4 違反**: 診断が人向けの文章。i18n の欠落 276 件のように、本質（`update` を実行していない、の 1 件）が埋もれる
5. **A5 違反**: i18n の ja は仕様（`name`）から導けるのに、別ファイルで保守され、欠落がエラーになる

---

## 3. 設計の方針

1. **1 画面 = 1 ファイル。** 遷移・UI・状態・データ・イベントを 1 つにまとめる（A1, A3）
2. **遷移は書かない。導出する。** 画面の遷移グラフは、イベントの `navigate` ステップから導く（A3）
3. **すべてを型と式で書く。** 散文は `description` に置き、検証対象は構造にする（A2）
4. **OpenAPI の `operationId` までの接続を、書きやすく、検証できるようにする。** HTTP のメソッドとパスは仕様に書かない（A2）
5. **AI 向けの入口を用意する**: 全体の索引、画面ごとの文脈、機械可読な診断、修正の候補（A1, A4）
6. **生成物は手で書かない。** ja の文言、遷移図、索引（A5）
7. **error は実装不能なものだけ。** 翻訳の欠落などは info（A4）

---

## 4. 新しい構造

```text
specs/mobile/
├── app.yaml                       # アプリ全体の設定（旧 mobilespec.config.yml + L2.guards.yaml）
├── design-tokens.yaml             # 従来どおり
├── screens/
│   └── <group>/<id>.screen.yaml   # 1 画面 = 1 ファイル（旧 L2 + L3 + L4）
├── i18n/
│   ├── ja.json                    # 生成物（仕様の name / label から。手で編集しない）
│   └── <locale>.json              # 翻訳（ja のキーに対応。欠落は info）
└── .mobilespec/                   # 生成物（索引、遷移図）
    ├── index.md
    └── flows.md
```

### 4.1 `app.yaml`

```yaml
version: 2 # 仕様の書式のバージョン（このツールが対象とする）
groups: [home, item, misc] # 画面のグループ（遷移図・索引の並び）
locales: [ja, en] # ja は仕様から生成する元
openapi: ../../docs/specs/openapi.bundled.yaml # app.yaml からの相対パス
facts: # アプリ全体の事実（画面の状態では決まらない真偽値）。実装側が提供する
  isSignedIn: { description: サインイン済み }
  isGpsGranted: { description: 位置情報の権限が許可されている }
```

`facts` は、イベントの `when` と `conditions` の式から参照できる（旧 L2 の guard）。

### 4.2 画面ファイルの全体像

```yaml
id: item_detail
name: 項目の詳細 # 画面タイトル（ja。i18n の元）
kind: screen # screen | choice（choice は表示せず、自動で分岐する）
entry: false # アプリの起点（1 つ以上の画面が true）
root: false # タブの最上位など、直接到達できる画面
description: 項目の詳細を見せ、参加・退会を行う。

params: # この画面に渡されるパラメータ
  - { name: id, type: string, required: true }

data: # OpenAPI に接続するデータ
  queries:
    item: { operationId: getItem, args: { id: $params.id } }
    myStatus: { operationId: getMyStatus, args: { id: $params.id } }
  mutations:
    join:
      { operationId: joinItem, args: { id: $params.id }, options: { idempotent: true, retry: 2 } }

sources: # API 以外のデータ源
  heading: { kind: device, type: number, description: 端末の向き（度） }

state: # 画面ローカルの状態
  - { name: tab, type: string, enum: [info, members], default: info }

conditions: # 名前付きの式
  isLoading: { expr: item.isPending }
  canJoin:
    {
      expr: '!myStatus.data && !item.isPending && isSignedIn',
      description: メンバーでなく、取得済み、サインイン済み,
    }

ui: # 旧 L3
  layout: column
  headerRight:
    - component: IconButton
      id: btn_more
      name: メニュー
      menu: [{ id: menu_share, label: 共有, action: share }]
  children:
    - { component: Text, id: txt_title, name: タイトル, props: { value: item.data.title } }
    - { component: Button, id: btn_join, name: 参加する, action: join, visibleWhen: canJoin }
    - { component: List, id: list_members, name: メンバー, repeatFrom: item.data.members }

events: # 旧 L2 の遷移 + 旧 L4 のイベント
  join:
    when: canJoin
    steps:
      - mutate: join
      - refetch: [myStatus]
      - set: { tab: members }
  open_members:
    steps:
      - navigate: { to: item_members, params: { id: $params.id } }
  share:
    steps:
      - external: SDK のシェアシートを開く
```

### 4.3 イベントは「ステップの列」

1 つのイベントは、順に実行する `steps` の列。ステップの種類は 6 つだけ。

| ステップ                                         | 内容                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `navigate: { to, params }`                       | 画面へ遷移。`params` の値は式。**遷移グラフの辺はここから導く**                     |
| `stack: [ { navigate / push / replace: … }, … ]` | 複数画面にまたがる遷移（旧 `navigateStack`）                                        |
| `mutate: <mutation のキー>`                      | `data.mutations` の呼び出し。失敗したら以降を実行せず、`onError` があればそれを実行 |
| `refetch: [<query のキー>]`                      | `data.queries` の再取得                                                             |
| `set: { <state の名前>: <式> }`                  | 状態の更新                                                                          |
| `external: <説明>`                               | 外部（SDK・OS）に処理を委ねる                                                       |

イベントのその他のキー:

| キー          | 内容                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `when`        | 実行できる条件（式）。省略は常に可                                                                                                         |
| `on`          | 起動のきっかけ。`ui`（既定。UI の `action` が起動）/ `enter`（画面表示時）/ `auto`（`when` が真になったら自動。`choice` 画面の分岐に使う） |
| `else`        | `true` なら、`choice` 画面で、他の `auto` イベントがどれも成立しないときの分岐                                                             |
| `onError`     | `mutate` が失敗したときのステップの列                                                                                                      |
| `description` | 人向けの説明                                                                                                                               |

> 旧体系との対応: L2 の transition（`tap` / `auto`、`guard`、`else`）→ イベントの `navigate` ステップ + `on` / `when` / `else`。L4 の `update` / `callMutation` / `updateState` / `navigateStack` / `external` → ステップ。`onEnterEffects` → `on: enter` のイベント。

### 4.4 型と式

**型**: `string` / `number` / `boolean` / `{ a: string, b: number? }`（`?` は省略可）/ `[string]` / `$ref: '#/components/schemas/X'`（OpenAPI）/ `unknown`（未定義。info）。`enum:` で値を列挙。クエリの結果の型は OpenAPI の応答スキーマから導く（宣言しない）。

**式**: 実行しない。構文を解析し、参照を検証するだけ（任意コードの実行はしない）。

- 参照: `$params.x`、`state の名前`、`query の名前.data`（`.isPending` / `.isError`）、`source の名前`、`facts の名前`、`conditions の名前`、ドット区切り、`.length`
- 演算: `!` `&&` `||` `==` `!=` `<` `<=` `>` `>=`、括弧、リテラル（文字列・数値・真偽値・`null`）

関数呼び出し、代入、ループは書けない。足りないときは `description` に散文で書く。

### 4.5 UI（旧 L3）の変更点

- `action` は、**同じ画面の `events` のキー**と一致すること（全画面の集合ではなく、画面単位で検証する）
- `visibleWhen` / `repeatFrom` / `props` の値は式。参照を検証する
- `headerRight`、`menu`、`states` は従来どおり（`ui` の配下に統一）
- 文言は `name`（部品名）と `label`（メニュー項目）。ja の元。i18n のキーはこれらから導く

---

## 5. 導出されるもの（手で書かない）

| 生成物                 | 内容                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 遷移グラフ             | イベントの `navigate` / `stack` ステップから導く。到達可能性の検査、遷移図（Mermaid）、索引に使う                                                               |
| `i18n/ja.json`         | `name` / `label` / 画面の `name` から。`update` で再生成。`check` は、ja.json が仕様と食い違っていたら **1 件の error**（「`mobilespec update` を実行」）にする |
| `.mobilespec/index.md` | 全体の索引（§6.2）。`update` で再生成                                                                                                                           |
| `.mobilespec/flows.md` | 遷移図（従来の `flows.md`）                                                                                                                                     |

---

## 6. AI 向けの入口（CLI）

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
      "file": "screens/item/item_detail.screen.yaml",
      "pointer": "/events/join/when",
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

AI が最初に読む 1 枚。画面の一覧（id、name、group、起点・root、遷移先、使う `operationId`、条件・状態の数）と、遷移の辺、`operationId` の使用状況だけ。**全体像を、画面ファイルを開かずに把握する**。

### 6.3 画面の文脈（A1）

```bash
mobilespec context <screen-id>
```

1 画面の実装・修正に必要なものを、解決済みでまとめて出す。

- 画面の仕様（そのファイル）
- この画面への遷移（誰が、どの `params` で来るか）と、この画面からの遷移（行き先の `params` の契約）
- 使う `operationId` の入出力の型（OpenAPI から。URL・HTTP メソッドは出さない）
- 参照する `facts` の説明
- ja の文言（画面のタイトルと部品名）

AI は、`index` で全体を掴み、`context` で 1 画面を掴み、その画面のファイルだけを編集する。

### 6.4 その他

| コマンド                             | 内容                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `mobilespec new <id> --group <g>`    | 最小の有効な画面ファイルを作る（書式を暗記しなくてよい）                             |
| `mobilespec guide`                   | AI 向けの短い仕様（`docs/LLM_SPEC.md`）をパッケージから出す                          |
| `mobilespec update [--check]`        | 生成物（ja.json、索引、遷移図）を更新。`--check` は更新が必要かの検査のみ（CI 向け） |
| `mobilespec migrate`                 | 旧体系（L2/L3/L4）→ 新体系（§8）                                                     |
| `mobilespec check` / `openapi-check` | 従来どおり（`openapi-check` は `check` に統合する。`app.yaml` の `openapi` を使う）  |

スキーマ（`schema/*.json`）は、エディタ・AI のための補完の元として配る。

---

## 7. 検証

error は「実装不能」のものだけ。

| 検査                                                                                             | レベル                         |
| ------------------------------------------------------------------------------------------------ | ------------------------------ |
| スキーマ違反（プロパティ名・許可される値を含む）                                                 | error                          |
| 式の構文エラー、存在しない名前の参照（`suggest` 付き）                                           | error                          |
| `entry` が 0 件、`entry` / `root` から到達不能な画面（予約語 `external` を除く）                 | error                          |
| `navigate` の `to` が存在しない画面。`params` が遷移先の `params` と食い違う（必須の欠落・未知） | error                          |
| `choice` 画面: `auto` のイベントに `when` も `else` も無い、`else` が複数                        | error                          |
| UI の `action` が、同じ画面の `events` に無い                                                    | error                          |
| `mutate` / `refetch` が、存在しない `data` のキーを参照。`operationId` が OpenAPI に無い         | error                          |
| `args` が OpenAPI の引数と食い違う（必須の欠落・未知）                                           | error                          |
| `set` の対象が `state` に無い、型が明らかに不一致                                                | error                          |
| `ja.json` が仕様と食い違う（古い）                                                               | error（1 件。`update` を促す） |
| 他のロケールの翻訳の欠落・未翻訳                                                                 | info（集計）                   |
| `type: unknown`、未使用の state / query / condition / event / fact                               | info                           |
| 説明や文字列に HTTP メソッド + パスが書かれている                                                | info（構造に直すよう促す）     |

---

## 8. 移行

```bash
mobilespec migrate --from <旧 specs-dir> --to <新 specs-dir> [--openapi <path>]   # 既定は dry-run
mobilespec migrate ... --write
```

- 旧 L2 / L3 / L4 を **1 画面 1 ファイル**にまとめる（L2 の transition と L4 の `navigate` イベントを突き合わせ、イベントの `navigate` ステップにする）
- `guard` → `when`（旧 guard の名前は `facts` / `conditions` の名前に。`L2.guards.yaml` → `app.yaml` の `facts`）
- `state` / `stateData` / `dataSource` / `conditions`（散文）→ 型付きの `state` / `conditions`。型や式を決められないものは `unknown` / `description` のみとし、**散文は失わない**。件数は info に出る
- `'API: GET /items/{id}'` のような取得元は、OpenAPI を引いて `operationId` を特定し、`data.queries` にする。特定できなければ TODO
- `update` イベントで、`description` に API 呼び出しがあるものは、`mutate` ステップにする（特定できなければ TODO）
- 未知のキー（`bleFlow` など）→ `x-<キー>`（拡張。検証しない）
- 旧 i18n は、ja を捨て（仕様から再生成）、他のロケールはそのまま移す
- 変換後に `check` を実行し、結果と TODO の一覧を出す。変換は情報を失わない

先行して取り込んだ構造（1.2 のスキーマ拡張: `navigateStack`、`updateState`、`external`、`root`、`headerRight` など）は、新体系の語彙に統合する。

---

## 9. 互換性と版

- 旧体系（`L2.screenflows/`、`L3.ui/`、`L4.state/`）の検証は、1.2.0 で**削除する**。旧体系の仕様は `migrate` で移行する
- **注意（版の指定）**: 実運用の利用側（複数のプロジェクト）は `^1.1.8` で使っている。`^1.1.8` は 1.2.0 に解決されるため、ロックファイルを更新すると、旧体系の仕様の CI が壊れる（今も、旧体系の仕様は検証を通っていないが）。1.2.0 を公開する前に、利用側を `~1.1.8` に固定するか、版を 2.0.0 にする
- 公開（タグ付け）は、移行の動作確認が終わってから、別途承認を得て行う

---

## 10. 実装の段階（承認後）

| 段階 | 内容                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------- |
| 1    | 新スキーマ（`app.yaml`、画面ファイル）と読み込み。式のパーサと型                                                    |
| 2    | 検証（§7）。診断の JSON 出力と `suggest`                                                                            |
| 3    | 導出（遷移グラフ、到達可能性）。`update`（ja.json、索引、遷移図）、`update --check`                                 |
| 4    | OpenAPI との整合（`args`、型の導出）。`openapi-check` の統合                                                        |
| 5    | AI 向けコマンド: `index`、`context`、`new`、`guide`                                                                 |
| 6    | `migrate`。架空の旧体系の例でテスト                                                                                 |
| 7    | 実運用の旧体系の仕様で `migrate` を試験（**読み取り専用。元には書かない**）し、変換の精度と、読み取り量の削減を測る |
| 8    | ドキュメント（構造モデル、検証モデル、LLM_SPEC、README）、ADR、CHANGELOG                                            |
| 9    | 公開の判断（**タグ付けは別途承認**）                                                                                |

旧体系の検証コードは、段階 6 で `migrate` が使う読み込み部分を除いて削除する。

効果の測定（段階 7）: 同じ画面を実装するのに AI が読むバイト数（旧: 3 ファイル + 補助 / 新: `index` + `context`）、`check` の修正ループの回数、`migrate` の自動変換率。

---

## 11. 決めたこと（ユーザーの指示「適宜、修正してください」に基づく私の判断）と、確認したいこと

### 決めたこと

| 項目             | 決定                                                               | 理由                                                         |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| ファイル構成     | 1 画面 = 1 ファイル                                                | A1, A3                                                       |
| 遷移             | 書かず、導出する                                                   | A3（遷移先・ID の二重記述をなくす）                          |
| イベント         | `steps` の列、ステップは 6 種                                      | A2。散文の `update` をなくす                                 |
| 条件の指定       | `guard`（名前）→ `when`（式）                                      | A2。名前の二重管理（L2 の guard と L4 の condition）をなくす |
| 式言語           | 自前の小さな部分集合                                               | 依存を増やさない。足りなければ CEL に移行                    |
| 旧体系との共存   | しない（1.2.0 で削除。`migrate` で移行）                           | 破壊的変更を許容する指示。二重の保守を避ける                 |
| i18n             | ja は生成物。ja の食い違いは 1 件の error。他ロケールの欠落は info | A5、「実装不能」だけを error にする方針                      |
| `sources` の初版 | `device` / `storage`                                               | 先行例がない。使いながら足す                                 |
| 診断             | JSON 出力（`code` / `file` / `pointer` / `expected` / `suggest`）  | A4                                                           |

### 確認したいこと

1. **版**: 1.2.0 で公開してよいか（利用側を `~1.1.8` に固定する前提）。それとも 2.0.0 にするか
2. **1 画面 = 1 ファイルへの統合**は、最大の変更（旧 L2/L3/L4 の分け方を捨てる）。これでよいか。L2/L3/L4 の分離を維持したい理由があれば教えてほしい
3. **イベントの `steps` モデル**（§4.3）で、実運用の表現が足りるか。実運用の 90 イベント（navigate 57 / update 29 / navigateStack 2 / updateState 1 / external 1）は、すべて表現できる見込み
4. **AI 向けコマンド**（§6）の範囲。特に `context`（1 画面の解決済みの文脈）を最優先で作る想定でよいか
