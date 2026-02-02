# mobilespec - モバイルアプリ仕様管理ライブラリ

## 概要

**mobilespec** は、モバイルアプリの仕様を L2/L3/L4 の 3層構造で管理・検証・生成するための汎用ライブラリです。

YAML ファイルで仕様を定義し、以下の機能を提供します：

- ✅ **バリデーション** - スキーマ検証とクロスバリデーション
- 📊 **Mermaid 図生成** - 画面遷移フロー図の自動生成
- 🌍 **多言語生成** - i18n JSON ファイルの自動生成

## ディレクトリ構造

```
mobilespec/
├── README.md           # このファイル
├── package.json        # パッケージ定義
├── tsconfig.json       # TypeScript設定
├── schema/             # JSON スキーマ定義
│   ├── L2.screenflows.schema.json
│   ├── L3.ui.schema.json
│   └── L4.state.schema.json
├── src/
│   ├── index.ts        # メインエントリーポイント
│   ├── validate.ts     # バリデーション関数
│   ├── generateMermaid.ts   # Mermaid 生成
│   ├── generateI18n.ts      # i18n 生成
│   └── bin/
│       └── cli.ts      # CLI エントリーポイント
└── dist/               # コンパイル済みJavaScript
    ├── index.js
    ├── validate.js
    ├── generateMermaid.js
    ├── generateI18n.js
    └── bin/
        └── cli.js      # 実行可能CLI
```

## インストール

```bash
npm install
npm run build
```

## 使用方法

### 1. CLI で実行

```bash
# バリデーション
node dist/bin/cli.js validate --specs-dir /path/to/specs

# Mermaid 図生成
node dist/bin/cli.js mermaid --specs-dir /path/to/specs

# 多言語ファイル生成
node dist/bin/cli.js i18n --specs-dir /path/to/specs
```

### 2. プログラムから import

```typescript
import { validate, generateMermaid, generateI18n } from 'mobilespec';

const options = {
  specsDir: '/path/to/specs',
  schemaDir: '/path/to/schema'
};

// バリデーション実行
const result = validate(options);

if (result.errors.length === 0) {
  // Mermaid 図生成
  await generateMermaid(options);
  
  // 多言語ファイル生成
  await generateI18n(options);
}
```

### 3. Makefile で実行（推奨）

specs ディレクトリに Makefile を用意することで、簡単に実行できます：

```bash
cd /path/to/specs
make build    # 全て実行
make validate # バリデーションのみ
```

## L2/L3/L4とは

### L2: 画面遷移定義（Screen Flows）

**目的**: アプリ全体の画面遷移フローを定義

**ファイル**: `screenflows/*.flow.yaml`

**内容**:
- 画面ID（screen_xxx）
- 遷移ID（action_xxx）
- 遷移条件
- 画面間の関係

**例**:
```yaml
context: auth
screens:
  - id: screen_splash
    type: entry
  - id: screen_onboarding
  - id: screen_home
    type: exit
transitions:
  - id: action_start_onboarding
    from: screen_splash
    to: screen_onboarding
```

### L3: UI定義（UI Specifications）

**目的**: 各画面のUI要素とアクションを定義

**ファイル**: `ui/**/*.ui.yaml`

**内容**:
- UI要素（ボタン、テキスト、リスト等）
- ユーザーアクション（タップ、スワイプ等）
- L2遷移IDとの紐付け

**例**:
```yaml
screen: screen_splash
elements:
  - id: element_logo
    type: image
  - id: element_loading
    type: progress
actions:
  - id: action_start_onboarding
    trigger: auto
    delay: 2000
```

### L4: 状態・データ定義（State & Data）

**目的**: 各画面の状態とデータソースを定義

**ファイル**: `state/**/*.state.yaml`

**内容**:
- 画面状態（loading, ready, error, empty）
- データソース（api, localStorage, static）
- 条件分岐ロジック

**例**:
```yaml
screen: screen_home
states:
  - id: state_loading
    initial: true
  - id: state_ready
  - id: state_error
dataSources:
  - id: data_venues
    type: api
    endpoint: /venues/nearby
```

## 運用フロー

### 1. 仕様変更時

```
1. L2/L3/L4 YAMLを更新
2. バリデーション実行（npm run validate）
3. 差分確認（実装との乖離を確認）
4. 実装
5. レビュー
```

### 2. 新機能追加時

```
1. requirements.md に要件追加
2. L2に画面遷移追加
3. L3にUI定義追加
4. L4に状態定義追加
5. バリデーション実行
6. 実装
```

### 3. バリデーション

```bash
cd .kiro/specs/asanowa/mobile
npm run validate
```

**チェック内容**:
- L2スキーマ検証
- L3スキーマ検証
- L4スキーマ検証
- L3-L2整合性（actionフィールドとtransition IDの一致）
- L4-L2整合性（screen IDの一致）

## 既存Flutter実装との対応

### 画面マッピング

| Flutter実装 | L2 Screen ID | 説明 |
|------------|--------------|------|
| `splash_screen.dart` | `screen_splash` | スプラッシュ |
| `onboarding_screen.dart` | `screen_onboarding` | オンボーディング |
| `nickname_input_screen.dart` | `screen_nickname_input` | ニックネーム入力 |
| `auth/social_login_screen.dart` | `screen_social_login` | ソーシャルログイン |
| `main/main_screen.dart` | `screen_main` | メイン（ボトムナビ） |
| `home_screen.dart` | `screen_home` | ホーム |
| `map/map_screen.dart` | `screen_map` | 地図 |
| `venues/venue_list_screen.dart` | `screen_venue_list` | 開催地一覧 |
| `venue_detail_screen.dart` | `screen_venue_detail` | 開催地詳細 |
| `venues/venue_registration_screen.dart` | `screen_venue_registration` | 開催地登録 |
| `venues/venue_edit_screen.dart` | `screen_venue_edit` | 開催地編集 |
| `manager/venue_management_list_screen.dart` | `screen_venue_management` | 管理者用開催地一覧 |
| `participation/participation_screen.dart` | `screen_participation` | 参加 |
| `stamp_book/stamp_book_screen.dart` | `screen_stamp_book` | スタンプ帳 |
| `settings_screen.dart` | `screen_settings` | 設定 |
| `notification_settings_screen.dart` | `screen_notification_settings` | 通知設定 |
| `system_info_screen.dart` | `screen_system_info` | システム情報 |
| `debug_screen.dart` | `screen_debug` | デバッグ |

### ルーティング対応

| Flutter Route | L2 Transition ID | 説明 |
|--------------|------------------|------|
| `/` | - | スプラッシュ（entry） |
| `/onboarding` | `action_start_onboarding` | オンボーディング開始 |
| `/nickname-input` | `action_input_nickname` | ニックネーム入力 |
| `/social-login` | `action_open_social_login` | ソーシャルログイン |
| `/home` | `action_complete_auth` | 認証完了 |
| `/venue-list` | `action_open_venue_list` | 開催地一覧 |
| `/venue-registration` | `action_open_venue_registration` | 開催地登録 |
| `/venue-management` | `action_open_venue_management` | 開催地管理 |

## 運用フロー

### 仕様変更時

```bash
# 1. L2/L3/L4 YAMLを更新
vim .kiro/specs/asanowa/mobile/screenflows/*.flow.yaml

# 2. バリデーション
cd .kiro/specs/asanowa/mobile
npm run validate

# 3. Mermaid図生成
npm run mermaid

# 4. i18n生成
npm run i18n

# 5. 実装
# Flutter実装を更新

# 6. レビュー
# 仕様と実装の整合性を確認
```

### 新機能追加時

```bash
# 1. requirements.md に要件追加
vim .kiro/specs/asanowa/mobile/requirements.md

# 2. L2に画面遷移追加
vim .kiro/specs/asanowa/mobile/screenflows/new_feature.flow.yaml

# 3. L3にUI定義追加
vim .kiro/specs/asanowa/mobile/ui/new_feature/*.ui.yaml

# 4. L4に状態定義追加
vim .kiro/specs/asanowa/mobile/state/new_feature/*.state.yaml

# 5. バリデーション
npm run validate

# 6. 実装
# Flutter実装を追加
```

## ツール

### バリデーション

```bash
cd .kiro/specs/asanowa/mobile
npm run validate
```

### Mermaid図生成

```bash
cd .kiro/specs/asanowa/mobile
npm run mermaid
```

### i18n生成

```bash
cd .kiro/specs/asanowa/mobile
npm run i18n
```

### 全実行

```bash
cd .kiro/specs/asanowa/mobile
npm run build
```

## 参考

- [L4仕様書](../../docs/mobile/L4_STATE_SPEC.md)
- [i18n/ID命名規則](../../docs/mobile/i18n_and_id_rules.md)
