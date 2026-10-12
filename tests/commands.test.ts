// tests/commands.test.ts — update / index / context / new / guide / report と、ビルド済み CLI
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildContext, renderContext, stripProse } from '../src/commands/context.js';
import { runNew } from '../src/commands/new.js';
import { runUpdate } from '../src/commands/update.js';
import { buildGraph } from '../src/core/derive.js';
import { errorsOf } from '../src/core/diagnostic.js';
import { renderFlowchart } from '../src/gen/flows.js';
import { renderIndex } from '../src/gen/index.js';
import { buildReport, toJson } from '../src/report.js';
import { validate } from '../src/validate.js';
import { FILES, makeProject, write } from './helpers/okProject.js';

const schemaDir = path.resolve(process.cwd(), 'schema');

describe('update: 生成物', () => {
  it('ja.json・索引・遷移図を生成し、2 回目は何も変えない（決定的）。--check は最新なら成功', () => {
    const specsDir = makeProject({ 'i18n/ja.json': '{}\n' });
    expect(
      errorsOf(validate({ specsDir, schemaDir })).some((d) => d.code === 'I18N_JA_STALE')
    ).toBe(true);

    const first = runUpdate({ specsDir });
    expect(first.ok && first.written).toContain('i18n/ja.json');
    expect(errorsOf(validate({ specsDir, schemaDir }))).toEqual([]);

    const second = runUpdate({ specsDir });
    expect(second.ok && second.written).toEqual([]);

    const check = runUpdate({ specsDir, check: true });
    expect(check.ok && check.stale).toEqual([]);
  });

  it('--check: 仕様を変えて update していなければ、古い生成物を報告する。書き込まない', () => {
    const specsDir = makeProject();
    runUpdate({ specsDir });
    write(
      specsDir,
      'L2.screenflows/home/home.flow.yaml',
      FILES['L2.screenflows/home/home.flow.yaml'].replace('name: ホーム', 'name: トップ')
    );
    const before = fs.readFileSync(path.join(specsDir, 'i18n/ja.json'), 'utf8');
    const check = runUpdate({ specsDir, check: true });
    expect(check.ok && check.stale).toEqual(
      expect.arrayContaining(['i18n/ja.json', '.mobilespec/index.md'])
    );
    expect(fs.readFileSync(path.join(specsDir, 'i18n/ja.json'), 'utf8')).toBe(before);
  });

  it('ja 以外の翻訳は、既存の翻訳を保ち、不足キーを空文字で足す', () => {
    const specsDir = makeProject({ 'i18n/en.json': '{"app.screen.home.title": "Home"}\n' });
    runUpdate({ specsDir });
    const en = JSON.parse(fs.readFileSync(path.join(specsDir, 'i18n/en.json'), 'utf8'));
    expect(en['app.screen.home.title']).toBe('Home');
    expect(en['app.screen.item_detail.title']).toBe('');
  });

  it('YAML が壊れていると、生成せずに止まる', () => {
    const specsDir = makeProject({ 'L3.ui/home.ui.yaml': 'layout: [\n' });
    const r = runUpdate({ specsDir });
    expect(r.ok).toBe(false);
  });
});

describe('index / flows', () => {
  it('索引は、画面・遷移・API を 1 枚にまとめる。ファイルを開かずに全体が掴める', () => {
    const specsDir = makeProject();
    const r = validate({ specsDir, schemaDir });
    const md = renderIndex(r.project, r.edges);
    expect(md).toContain('画面 3 / 遷移 5 / 使う API 3');
    expect(md).toContain('| item_detail | 項目の詳細 |');
    expect(md).toContain('home --open_item--> item_detail {id}');
    expect(md).toContain('item_detail --open_share--> external');
    expect(md).toContain('| getItem | item_detail |');
    // 決定的
    expect(renderIndex(r.project, r.edges)).toBe(md);
  });

  it('遷移図（Mermaid）: グループごとの subgraph、entry の印、external ノード、auto は点線', () => {
    const specsDir = makeProject({
      'L2.screenflows/home/home.flow.yaml':
        FILES['L2.screenflows/home/home.flow.yaml'] +
        '  - id: go_a\n    auto: true\n    when: isSignedIn\n    target: item_members\n    params: { id: x }\n',
    });
    const r = validate({ specsDir, schemaDir });
    const m = renderFlowchart(r.project, buildGraph(r.project));
    expect(m).toContain('flowchart LR');
    expect(m).toContain('subgraph grp_home["home"]');
    expect(m).toContain('home ⭐');
    expect(m).toContain('external(("external"))');
    expect(m).toContain('-.->');
  });
});

describe('context: 1 画面ぶんの文脈', () => {
  const specsDir = makeProject();
  const r = validate({ specsDir, schemaDir });

  it('3 層 + 前後の遷移 + API の入出力 + fact + ja の文言。散文は既定で出さない', () => {
    const model = buildContext(r.project, r.edges, r.openapi, 'item_detail')!;
    expect(model.files.l4).toBe('L4.state/item_detail.state.yaml');
    expect(model.incoming).toEqual([{ from: 'home', transition: 'open_item', params: ['id'] }]);
    expect(model.outgoing.map((e) => e.transition)).toEqual([
      'open_members',
      'after_join',
      'open_share',
      'back_home',
    ]);
    expect(model.operations.map((o) => o.operationId).sort()).toEqual([
      'getItem',
      'getMyStatus',
      'joinItem',
    ]);
    const getItem = model.operations.find((o) => o.operationId === 'getItem')!;
    expect(getItem.params).toEqual(['id(path, string, 必須)']);
    expect(getItem.response).toContain('Item');
    expect(model.facts.map((f) => f.name)).toEqual(['isSignedIn']);
    expect(model.ja['app.screen.item_detail.title']).toBe('項目の詳細');

    const text = renderContext(model);
    expect(text).not.toContain('参加の完了後'); // description は出さない
    expect(text).not.toMatch(/https?:\/\/|GET \/|PUT \//); // URL・HTTP メソッドは出さない
    expect(text).toContain('go: after_join');
  });

  it('--docs では散文も出す', () => {
    const model = buildContext(r.project, r.edges, r.openapi, 'item_detail', { docs: true })!;
    expect(renderContext(model)).toContain('参加の完了後');
    expect(model.operations.find((o) => o.operationId === 'getItem')!.summary).toBe(
      '項目を取得する'
    );
  });

  it('存在しない画面は undefined', () => {
    expect(buildContext(r.project, r.edges, r.openapi, 'nope')).toBeUndefined();
  });

  it('stripProse: 最上位の散文と各項目の説明だけを取り除き、データの名前は残す', () => {
    expect(
      stripProse({
        summary: 's',
        a: 1,
        events: {
          e: { description: 'x', steps: [{ set: { status: 'closed', description: 'd' } }] },
        },
      })
    ).toEqual({
      a: 1,
      events: { e: { steps: [{ set: { status: 'closed', description: 'd' } }] } },
    });
  });

  it('check --screen: 存在しない画面は error。他画面の診断だけを除く', () => {
    const specsDir = makeProject();
    const r = validate({ specsDir, schemaDir, screen: 'nosuch' });
    expect(r.diagnostics.some((d) => d.code === 'SCREEN_NOT_FOUND')).toBe(true);
  });
});

describe('new: 雛形', () => {
  it('最小の有効な画面を作る。重複・不正なグループ・不正な ID は拒否', () => {
    const specsDir = makeProject();
    const r = runNew({ specsDir, id: 'settings', group: 'item', name: '設定' });
    expect(r.ok && r.files).toEqual([
      'L2.screenflows/item/settings.flow.yaml',
      'L3.ui/settings.ui.yaml',
      'L4.state/settings.state.yaml',
    ]);
    // 新しい画面は、到達できないので error（root か遷移が必要）。それ以外は有効
    runUpdate({ specsDir });
    const errs = errorsOf(validate({ specsDir, schemaDir }));
    expect(errs.map((d) => d.code)).toEqual(['UNREACHABLE_SCREEN']);

    expect(runNew({ specsDir, id: 'settings', group: 'item' }).ok).toBe(false);
    expect(runNew({ specsDir, id: 'x', group: 'nope' }).ok).toBe(false);
    expect(runNew({ specsDir, id: 'Bad', group: 'item' }).ok).toBe(false);
  });
});

describe('report', () => {
  it('JSON: ok / errors / diagnostics（file + pointer + found / expected / suggest）', () => {
    const specsDir = makeProject({
      'L3.ui/item_detail.ui.yaml': FILES['L3.ui/item_detail.ui.yaml'].replace(
        'action: open_members',
        'action: open_memberz'
      ),
    });
    const body = JSON.parse(toJson(validate({ specsDir, schemaDir }).diagnostics));
    expect(body.ok).toBe(false);
    const d = body.diagnostics.find((x: { code: string }) => x.code === 'UNKNOWN_ACTION');
    expect(d).toMatchObject({
      file: 'L3.ui/item_detail.ui.yaml',
      pointer: '/layout/children/0/action',
      found: 'open_memberz',
      suggest: 'open_members',
    });
    expect(d.expected).toContain('open_members');
  });

  it('テキスト: info は集計され、要約で終わる。--verbose は全件', () => {
    const specsDir = makeProject({ 'i18n/en.json': '{}\n' });
    const diagnostics = validate({ specsDir, schemaDir }).diagnostics;
    const brief = buildReport(diagnostics);
    expect(brief.infos.join('\n')).toContain('未翻訳: locale="en"');
    expect(brief.summary).toContain('error 0 件');
    const full = buildReport(diagnostics, { verbose: true });
    expect(full.infos.length).toBeGreaterThanOrEqual(brief.infos.length);
  });
});

// ビルド済みの CLI（CI では build の後にテストが走る）
const cli = path.resolve(process.cwd(), 'dist/bin/cli.js');
describe.skipIf(!fs.existsSync(cli))('CLI（ビルド済み）', () => {
  const run = (args: string[], cwd?: string) =>
    spawnSync('node', [cli, ...args], { encoding: 'utf8', cwd });

  it('check: 有効なプロジェクトは終了コード 0、壊すと 1 + JSON', () => {
    const specsDir = makeProject();
    const ok = run(['check', '--specs-dir', specsDir]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('✅ check OK');

    write(
      specsDir,
      'L3.ui/home.ui.yaml',
      FILES['L3.ui/home.ui.yaml'].replace('action: open_item', 'action: nope')
    );
    const ng = run(['check', '--specs-dir', specsDir, '--format', 'json']);
    expect(ng.status).toBe(1);
    expect(JSON.parse(ng.stdout).errors).toBeGreaterThan(0);
  });

  it('index / context / guide / new / update --check', () => {
    const specsDir = makeProject();
    expect(run(['index', '--specs-dir', specsDir]).stdout).toContain('# 画面の索引');
    const ctx = run(['context', 'item_detail', '--specs-dir', specsDir]);
    expect(ctx.status).toBe(0);
    expect(ctx.stdout).toContain('# context: item_detail');
    expect(run(['context', 'nope', '--specs-dir', specsDir]).status).toBe(1);
    expect(run(['guide']).stdout).toContain('mobilespec — AI 向けの仕様');
    expect(run(['new', 'foo', '--group', 'item', '--specs-dir', specsDir]).status).toBe(0);
    expect(run(['update', '--check', '--specs-dir', specsDir]).status).toBe(1); // 生成物が古い
    expect(run(['update', '--specs-dir', specsDir]).status).toBe(0);
    expect(run(['update', '--check', '--specs-dir', specsDir]).status).toBe(0);
  });
});
