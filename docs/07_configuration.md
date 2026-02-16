# Configuration

mobilespec.config.ymlは構造のみ定義する。

---

例：

```yaml
mermaid:
  groupOrder:
    - home
    - task
    - venue
    - misc

i18n:
  locales:
    - ja
    - en
    - zh-Hans
    - ko

openapi:
  path: ../../docs/specs/openapi.bundled.yaml
```

---

設計方針：

- buildフラグ禁止
- validationフラグ禁止
- 動作モード切替禁止
