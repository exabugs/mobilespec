# ライフサイクル

## 仕様の変更から実装まで

```text
mobilespec index / context <id>   現状を掴む
↓ L2 → L3 → L4 の順に仕様を編集
mobilespec check --screen <id>    診断に従って直す
mobilespec update                 生成物（ja.json、索引、遷移図）を更新
↓ 実装
mobilespec check && mobilespec update --check   CI
```

## 新しい画面

`mobilespec new <id> --group <g>` が、最小の有効な L2 / L3 / L4 を作る。

## 旧体系（1.x）から

```bash
mobilespec migrate --specs-dir <旧> --openapi <path>          # dry-run: 変換後の検証結果と TODO を報告
mobilespec migrate --specs-dir <旧> --to <新しい空のディレクトリ> # 書き出し
```

元のディレクトリは変更しない。TODO（OpenAPI で特定できなかった API、`visibleWhen` の整理、孤立画面など）は人が決める。
