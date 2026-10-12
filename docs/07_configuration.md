# 設定（app.yaml）

構造だけを定義する。モード切替・フラグは持たない。

```yaml
version: 2
groups: [home, item, misc] # 遷移図・索引の並び。L2 の group はここにあるものだけ
screenOrder: [home, item_list] # 任意: グループ内の並び
locales: [ja, en] # ja は仕様から生成する元
openapi: ../../docs/specs/openapi.bundled.yaml # app.yaml からの相対パス
facts: # アプリ全体の事実。L2 の when と L4 の conditions から参照する
  isSignedIn: { description: サインイン済み }
```

`facts` は、1.x の `L2.guards.yaml` の後継。`mobilespec.config.yml` は廃止（`migrate` が変換する）。
