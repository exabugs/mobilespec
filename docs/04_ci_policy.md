# CI Policy

CIは次のみを見る：

- error件数

infoは無視する。

---

## ルール

- error > 0 → exit 1
- error = 0 → success

---

## CI での実行コマンド（read-only）

CI では **mobilespec check のみ**を実行する。
`update`（i18n/mermaid 生成）は **CI では実行しない**（read-only を保つため）。

---

## GitHub Actions例

再利用ワークフロー（公開済みの `@exabugs/mobilespec` を使う）：

```yaml
jobs:
  sdd:
    uses: exabugs/mobilespec/.github/workflows/sdd-check.yml@main
    with:
      specs_dir: specs/mobile
      openapi_path: docs/specs/openapi.bundled.yaml # 任意
```

または、利用側のスクリプトを実行する：

```yaml
jobs:
  sdd:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # ... 依存関係のインストール
      - run: pnpm run sdd:check
```

CI が動いていることを確認する（パスが存在しない・古いバージョンを指す、などで一度も動いていない状態に注意）。
