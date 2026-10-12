// tests/schema-1.2.test.ts
//
// 実プロジェクト（asanowa）で使われていたのに、スキーマにも検証にもなかった構造を取り込んだことの検査。
// 例はすべて架空（構造だけを再現している）。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { generateMermaid } from '../src/generateMermaid.js';
import { resolveOpenapiPath } from '../src/openapiPath.js';
import { buildReport } from '../src/report.js';
import { errorsOf, findByCode } from '../src/types/diagnostic.js';
import { validate } from '../src/validate/index.js';
import { writeFile } from './helpers/mkSpec.js';
import { mkTempDir } from './helpers/mkTemp.js';
import { writeOkSpec } from './helpers/okSpec.js';

const schemaDir = path.resolve(process.cwd(), 'schema');

async function messages(specsDir: string): Promise<string[]> {
  const r = await validate({ specsDir, schemaDir });
  return errorsOf(r).map((d) => d.message);
}

/** i18n に、追加した画面・部品のキーを足す（ja / en 両方。値は空でない文字列） */
function addI18n(specsDir: string, keys: string[]) {
  for (const locale of ['ja', 'en']) {
    const file = path.join(specsDir, 'i18n', `${locale}.json`);
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
    for (const k of keys) json[k] = k;
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  }
}

/** 追加の L4 / L3 / L2 を差し替えた最小 OK セット（i18n は、追加した部品・画面のキーを足す） */
function setup(
  files: { l2?: Record<string, string>; l3?: Record<string, string>; l4?: Record<string, string> },
  i18nKeys: string[] = []
) {
  const specsDir = mkTempDir();
  const { l2, l3, l4 } = writeOkSpec(specsDir);
  for (const [name, text] of Object.entries(files.l2 ?? {})) writeFile(path.join(l2, name), text);
  for (const [name, text] of Object.entries(files.l3 ?? {})) writeFile(path.join(l3, name), text);
  for (const [name, text] of Object.entries(files.l4 ?? {})) writeFile(path.join(l4, name), text);
  addI18n(specsDir, i18nKeys);
  return specsDir;
}

const l3Home = (extra: string, children = '') => `
screen:
  id: home
  layout:
    type: column
    children:
      - component: Button
        id: action_open_tasks
        name: 未処理タスク
        action: open_tasks
${children}
${extra}
`;

describe('L4: 新しいイベントと拡張', () => {
  it('navigate の params / navigateStack / updateState / external を受け付ける', async () => {
    const specsDir = setup({
      l4: {
        'home.state.yaml': `
screen:
  id: home
  stateData:
    mode: system
  constants:
    TIMEOUT_MS: 10000
  onEnterEffects:
    sound: 入室時に効果音を再生する
  x-note: 拡張プロパティは検証されない
  events:
    open_tasks:
      type: navigate
      targetScreenId: tasks
      params:
        initialTab: nearby
    start_flow:
      type: navigateStack
      steps:
        - type: navigate
          targetScreenId: home
        - type: push
          targetScreenId: tasks
          params:
            id: abc
    change_mode:
      type: updateState
      field: mode
    open_ad:
      type: external
      description: SDK に委ねる
`,
      },
    });

    expect(await messages(specsDir)).toEqual([]);
  });

  it('navigateStack の steps が存在しない画面を参照したら error', async () => {
    const specsDir = setup({
      l4: {
        'home.state.yaml': `
screen:
  id: home
  events:
    open_tasks:
      type: navigate
      targetScreenId: tasks
    start_flow:
      type: navigateStack
      steps:
        - type: push
          targetScreenId: nowhere
`,
      },
    });

    const r = await validate({ specsDir, schemaDir });
    const d = findByCode(r, 'L4_UNKNOWN_SCREEN');
    expect(d?.level).toBe('error');
    expect(d?.message).toContain('nowhere');
  });
});

describe('L3: 画面内イベント / headerRight / menu / repeatFrom', () => {
  it('L3 の action は、同じ画面の L4 の画面内イベント（遷移を伴わない）と一致していればよい', async () => {
    const specsDir = setup(
      {
        l3: {
          'home.ui.yaml': l3Home(
            '',
            `      - component: Button
        id: btn_refresh
        name: 更新
        action: action_refresh`
          ),
        },
        l4: {
          'home.state.yaml': `
screen:
  id: home
  events:
    open_tasks:
      type: navigate
      targetScreenId: tasks
    action_refresh:
      type: update
      description: 一覧を再取得する
`,
        },
      },
      ['app.screen.home.component.btn_refresh.label']
    );

    expect(await messages(specsDir)).toEqual([]);
  });

  it('遷移（navigate）は、画面内イベントではないので、L2 に無ければ従来どおり error', async () => {
    const specsDir = setup({
      l3: {
        'home.ui.yaml': l3Home(
          '',
          `      - component: Button
        id: btn_go
        name: 移動
        action: action_go`
        ),
      },
      l4: {
        'home.state.yaml': `
screen:
  id: home
  events:
    open_tasks:
      type: navigate
      targetScreenId: tasks
    action_go:
      type: navigate
      targetScreenId: tasks
`,
      },
    });

    const r = await validate({ specsDir, schemaDir });
    expect(findByCode(r, 'L3_ACTION_NOT_IN_L2')?.meta?.action).toBe('action_go');
  });

  it('headerRight のメニュー項目の action も検査される（typo は error、正しければ OK）', async () => {
    const make = (action: string) =>
      setup({
        l3: {
          'home.ui.yaml': l3Home(`  headerRight:
    - component: IconButton
      id: btn_more
      name: メニュー
      props:
        icon: dots-vertical
      menu:
        - id: menu_tasks
          icon: history
          label: タスク
          action: ${action}`),
        },
      });

    expect(await messages(make('open_tasks'))).toEqual([]);

    const r = await validate({ specsDir: make('open_tasks_typo'), schemaDir });
    expect(findByCode(r, 'L3_ACTION_NOT_IN_L2')?.meta?.action).toBe('open_tasks_typo');
  });

  it('repeatFrom は、キャメルケースやドット区切りの参照を許す。states も書ける', async () => {
    const specsDir = setup(
      {
        l3: {
          'home.ui.yaml': l3Home(
            `  states:
    idle:
      description: 待機中
    sending:
      description: 送信中`,
            `      - component: List
        id: list_log
        name: ログ
        repeatFrom: writeLog.items`
          ),
        },
      },
      ['app.screen.home.component.list_log.label']
    );

    expect(await messages(specsDir)).toEqual([]);
  });
});

describe('L2: description / external / root', () => {
  it('transition の description と、予約語 external への遷移を受け付ける（external は画面として存在しなくてよい）', async () => {
    const specsDir = setup(
      {
        l2: {
          'home.flow.yaml': `
screen:
  id: home
  name: ホーム
  type: screen
  entry: true
  transitions:
    - id: open_tasks
      trigger: tap
      target: tasks
      description: タスク一覧へ
    - id: open_ad
      trigger: tap
      target: external
      description: SDK が遷移先を管理する
`,
        },
        l3: {
          'home.ui.yaml': l3Home(
            '',
            `      - component: AdCard
        id: ad
        name: 広告
        action: open_ad`
          ),
        },
      },
      ['app.screen.home.component.ad.label']
    );

    expect(await messages(specsDir)).toEqual([]);
  });

  it('root: true の画面（タブの最上位など）は、entry から辿れなくても到達不能にならない', async () => {
    const orphan = (root: string) => `
screen:
  id: ranking
  name: ランキング
  type: screen
${root}
  exit: true
  transitions: []
`;
    const without = setup({ l2: { 'ranking.flow.yaml': orphan('') } }, [
      'app.screen.ranking.title',
    ]);
    expect((await messages(without)).join('\n')).toContain('到達不能');

    const withRoot = setup({ l2: { 'ranking.flow.yaml': orphan('  root: true') } }, [
      'app.screen.ranking.title',
    ]);
    expect(await messages(withRoot)).toEqual([]);
  });
});

describe('診断の質', () => {
  it('スキーマ違反のメッセージに、問題のプロパティ名が出る', async () => {
    const specsDir = setup({
      l4: {
        'home.state.yaml': `
screen:
  id: home
  bleFlow: 手順
  events:
    open_tasks:
      type: navigate
      targetScreenId: tasks
`,
      },
    });

    const all = (await messages(specsDir)).join('\n');
    expect(all).toContain('未定義のプロパティ "bleFlow"');
  });

  it('イベントの余分なプロパティは、type が一致した定義のエラーだけが出る（oneOf のノイズなし）', async () => {
    const specsDir = setup({
      l4: {
        'home.state.yaml': `
screen:
  id: home
  events:
    open_tasks:
      type: navigate
      targetScreenId: tasks
      surprise: 1
`,
      },
    });

    const errs = (await messages(specsDir)).filter((m) => m.includes('スキーマエラー'));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('未定義のプロパティ "surprise"');
  });

  it('不明な type は、許可される値の一覧が出る。必須の欠落はプロパティ名が出る', async () => {
    const specsDir = setup({
      l4: {
        'home.state.yaml': `
screen:
  id: home
  events:
    open_tasks:
      type: navigate
      targetScreenId: tasks
    bad:
      type: teleport
    no_query:
      type: callQuery
`,
      },
    });

    const all = (await messages(specsDir)).join('\n');
    expect(all).toContain('許可:');
    expect(all).toContain('navigateStack');
    expect(all).toContain('必須プロパティ "query"');
  });
});

describe('buildReport: 出力の整理', () => {
  const missing = (locale: string, key: string) => ({
    code: 'I18N_MISSING_KEY' as const,
    level: 'error' as const,
    message: `i18n不整合: locale="${locale}" に key="${key}" が存在しません`,
    meta: { locale, key },
  });
  const untranslated = (locale: string, key: string) => ({
    code: 'I18N_UNTRANSLATED' as const,
    level: 'info' as const,
    message: `未翻訳: locale="${locale}" key="${key}" が空です`,
    meta: { locale, key },
  });

  const many = [
    ...Array.from({ length: 30 }, (_, i) => missing('en', `k${i}`)),
    ...Array.from({ length: 40 }, (_, i) => untranslated('ko', `k${i}`)),
    {
      code: 'L2_INVALID' as const,
      level: 'error' as const,
      message: '実装不能なエラー',
    },
  ];

  it('i18n は locale ごとに集計され、本質的なエラーが埋もれない。要約行が付く', () => {
    const r = buildReport(many);
    expect(r.errorCount).toBe(31);
    expect(r.infoCount).toBe(40);
    expect(r.errors).toHaveLength(2); // 実装不能なエラー + en の集計
    expect(r.errors.join('\n')).toContain('locale="en" 30 件');
    expect(r.infos).toHaveLength(1);
    expect(r.infos[0]).toContain('locale="ko" 40 件');
    expect(r.summary).toContain('error 31 件');
  });

  it('verbose は全件を出す。同じ内容は 1 件にまとめる', () => {
    const r = buildReport([...many, many[0]], { verbose: true });
    expect(r.errors).toHaveLength(31); // 重複した 1 件は除かれる
    expect(r.infos).toHaveLength(40);
  });
});

describe('resolveOpenapiPath', () => {
  it('--openapi の相対パスはカレント基準。カレントに無く仕様ディレクトリ基準にあるときは後者（後方互換）', () => {
    const root = mkTempDir();
    const specsDir = path.join(root, 'specs');
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'api.yaml'), 'x');
    fs.writeFileSync(path.join(specsDir, 'local.yaml'), 'x');

    const cwd = process.cwd();
    process.chdir(root);
    try {
      // カレント基準で見つかる（Makefile / package.json の書き方）
      expect(fs.realpathSync(resolveOpenapiPath(specsDir, 'docs/api.yaml', true))).toBe(
        fs.realpathSync(path.join(root, 'docs', 'api.yaml'))
      );
      // 仕様ディレクトリ基準でだけ見つかる（従来の書き方）
      expect(resolveOpenapiPath(specsDir, 'local.yaml', true)).toBe(
        path.join(specsDir, 'local.yaml')
      );
      // config の相対パスは仕様ディレクトリ基準
      expect(resolveOpenapiPath(specsDir, 'docs/api.yaml', false)).toBe(
        path.join(specsDir, 'docs/api.yaml')
      );
      // 絶対パスはそのまま
      expect(resolveOpenapiPath(specsDir, '/abs/x.yaml', true)).toBe('/abs/x.yaml');
    } finally {
      process.chdir(cwd);
    }
  });
});

describe('mermaid: external', () => {
  it('external への遷移は、画面でなく external ノードとして描く', async () => {
    const specsDir = setup({
      l2: {
        'home.flow.yaml': `
screen:
  id: home
  name: ホーム
  type: screen
  entry: true
  transitions:
    - id: open_ad
      trigger: tap
      target: external
    - id: open_tasks
      trigger: tap
      target: tasks
`,
      },
    });
    writeFile(
      path.join(specsDir, 'mobilespec.config.yml'),
      `
mermaid:
  groupOrder:
    - misc
`
    );

    await generateMermaid({ specsDir, schemaDir });
    const md = fs.readFileSync(path.join(specsDir, 'flows.md'), 'utf8');
    expect(md).toContain('external(("external"))');
    expect(md).toContain('home -->|open_ad/tap| external');
  });
});
