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

### Fixed

- README の「event ↔ L2 transition 不一致 → error」は実装と違っていた（info）。文書を実装に合わせた
