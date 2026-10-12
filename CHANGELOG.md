# Changelog

## [Unreleased] — 1.2.0 の予定

実際のプロジェクトの仕様が `mobilespec check` を通らない原因を調べ、**仕様の側の誤り**と **mobilespec の側の不足**に分けて、後者を取り込んだ。すべて後方互換（受け付ける仕様が増え、診断が読みやすくなる）。

### Added

- L4: `navigate` の `params`、`navigateStack`（`steps`: navigate / push / replace）、`updateState`（`field`）、`external` イベント
- L4: `stateData` / `constants` / `onEnterEffects`、`x-` で始まる拡張プロパティ
- L3: `headerRight`、`menu[]`（`action` も検査）、`states`。`repeatFrom` はキャメルケース・ドット区切りを許可
- L2: transition の `description`、screen の `description` と `root`（到達可能性の起点）、予約語 `external`（アプリ外の遷移先）
- CLI: `--verbose`、件数の要約、i18n の診断の locale ごとの集計
- `navigateStack` の steps が L2 に存在しない画面を参照したときの error

### Changed

- **L3 の action は、L2 の transition.id、または同じ画面の L4 の画面内イベント（update / updateState / callQuery / callMutation / external）と一致すればよい。** 従来は L2 の transition.id だけで、画面内の操作（再読み込み、期間切替など）を書けなかった
- 画面内イベントは、L2 に無くても「L4.events に存在するが L2 に存在しない eventKey」の info に出ない
- スキーマ違反のメッセージに、問題のプロパティ名・許可される値を含める。イベントの `oneOf` を `type` による分岐（`if / then`）にして、一致した定義のエラーだけを報告する（従来は全分岐のエラーが出ていた）。同一内容の診断は 1 件にまとめる
- `--openapi` の相対パスは、カレントディレクトリ基準にした（従来は仕様ディレクトリ基準で、Makefile / package.json の書き方では動かなかった）。カレント基準で見つからず仕様ディレクトリ基準で見つかるときは、後者を使う（後方互換）。config の `openapi.path` は従来どおり仕様ディレクトリ基準
- 再利用ワークフロー `sdd-check.yml` を、公開済みの `@exabugs/mobilespec` を使う形に作り直した（従来は利用側のリポジトリで `npm run build` を実行しており、動かなかった）。`fail_on_warnings` は効果なし（warning は存在しない方針）
- 自身の CI を pnpm にし、lint・format check を追加。テストの失敗が CI の失敗になるようにした（従来は `continue-on-error`）

### 出力・ワークフローの変更（利用側の確認事項）

- CLI の出力が変わった: 最後に error / info の件数の要約行を出す。i18n の欠落・未翻訳は locale ごとの集計になった（key ごとに grep しているスクリプトは `--verbose` を使う）。終了コードと、成功時の最後の行（`✅ check OK`）は変わらない
- 再利用ワークフロー `sdd-check.yml`: `mobilespec_version`（既定 `1` = 1.x の最新）を追加。`schema_dir` の既定は空（パッケージ同梱のスキーマ）、`upload_artifacts` の既定は `false`（`check` は生成物を作らないため）。`openapi_path` はリポジトリのルートからの相対パス（1.2 以降）
- `headerRight` と `menu[].label` の文言を、i18n の検査・生成（`update`）の対象にした。キーは `…component.<id>.label`（部品名・メニュー項目の id）
- 予約語 `external` を screen.id にすると error（1.1.x では有効な id だった。遷移先が曖昧になるため）
- 画面内イベントとみなす type は列挙（update / updateState / callQuery / callMutation / external）。綴り誤りは、L3 の照合を素通りしない

### Fixed

- README の「event ↔ L2 transition 不一致 → error」は実装と違っていた（info）。文書を実装に合わせた
