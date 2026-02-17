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

```yaml
jobs:
  sdd:
    run: pnpm run sdd:check
```
