# CI Policy

CIは次のみを見る：

- error件数

infoは無視する。

---

## ルール

- error > 0 → exit 1
- error = 0 → success

---

## GitHub Actions例

```yaml
jobs:
  sdd:
    run: pnpm run sdd:check
```
