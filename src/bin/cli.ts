#!/usr/bin/env node

// src/bin/cli.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { buildContext, renderContext } from '../commands/context.js';
import { exportModel, renderDocs, writeDocs } from '../commands/docs.js';
import { runMigrate } from '../commands/migrate.js';
import { runNew } from '../commands/new.js';
import { runUpdate } from '../commands/update.js';
import { renderIndex } from '../gen/index.js';
import { resolveOpenapiPath } from '../openapiPath.js';
import { buildReport, toJson } from '../report.js';
import { validate } from '../validate.js';

const HELP = `mobilespec — モバイル仕様（L2 / L3 / L4）の検証・生成

使い方: mobilespec <command> [options]

検証
  check [--screen <id>] [--format json] [--verbose]   仕様を検証する（read-only）。error があれば終了コード 1
AI 向け
  index                                              全体の索引（画面・遷移・API）を出力する
  context <screen-id> [--format json] [--docs]       1 画面ぶんの文脈（L2 / L3 / L4 + 前後の遷移 + API + 文言）
  new <screen-id> --group <g> [--name <ja>]          最小の有効な画面ファイル（L2 / L3 / L4）を作る
  guide                                              AI 向けの短い仕様を出力する
人間向け
  docs [--out <dir>]                                 Markdown + Mermaid のドキュメントを出す（既定: .mobilespec/docs）
  export                                             全体の機械可読モデル（JSON）を出力する
移行
  migrate [--to <dir>]                               旧体系（1.x）→ version 2 に変換する。--to なしは dry-run（検証結果だけ報告）
生成
  update [--check]                                   生成物（i18n/ja.json、.mobilespec/）を更新する。--check は検査のみ

共通: --specs-dir <dir>（既定: カレント）  --openapi <path>  --schema-dir <dir>
`;

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'specs-dir': { type: 'string' },
      'schema-dir': { type: 'string' },
      openapi: { type: 'string' },
      format: { type: 'string' },
      screen: { type: 'string' },
      group: { type: 'string' },
      name: { type: 'string' },
      verbose: { type: 'boolean' },
      check: { type: 'boolean' },
      docs: { type: 'boolean' },
      to: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const cmd = positionals[0] ?? 'check';
  if (values.help || cmd === 'help') {
    console.log(HELP);
    return;
  }
  const specsDir = path.resolve(values['specs-dir'] ?? process.cwd());
  const schemaDir = values['schema-dir'] ? path.resolve(values['schema-dir']) : undefined;
  const openapiPath = values.openapi
    ? resolveOpenapiPath(specsDir, values.openapi, true)
    : undefined;
  const json = values.format === 'json';

  switch (cmd) {
    case 'check': {
      const r = validate({ specsDir, schemaDir, openapiPath, screen: values.screen });
      if (json) {
        console.log(toJson(r.diagnostics));
        process.exit(r.diagnostics.some((d) => d.level === 'error') ? 1 : 0);
      }
      const report = buildReport(r.diagnostics, { verbose: values.verbose });
      for (const l of report.errors) console.error(l);
      for (const l of report.infos) console.log(l);
      console.log(report.summary);
      if (report.errorCount > 0) process.exit(1);
      console.log('✅ check OK');
      return;
    }

    case 'index': {
      const r = validate({ specsDir, schemaDir, openapiPath });
      console.log(renderIndex(r.project, r.edges));
      return;
    }

    case 'context': {
      const id = positionals[1];
      if (!id) fail('context には画面 ID が必要です: mobilespec context <screen-id>');
      const r = validate({ specsDir, schemaDir, openapiPath });
      const model = buildContext(r.project, r.edges, r.openapi, id, { docs: values.docs });
      if (!model) {
        const ids = [...r.project.screens.keys()];
        fail(`画面 "${id}" がありません（${ids.join(', ')}）`);
      }
      console.log(json ? JSON.stringify(model, null, 2) : renderContext(model));
      return;
    }

    case 'new': {
      const id = positionals[1];
      if (!id || !values.group)
        fail('使い方: mobilespec new <screen-id> --group <g> [--name <ja>]');
      const r = runNew({ specsDir, id, group: values.group, name: values.name });
      if (!r.ok) fail(r.message);
      for (const f of r.files) console.log(`✅ 作成: ${f}`);
      console.log('次: mobilespec check --screen ' + id + ' / mobilespec update');
      return;
    }

    case 'guide': {
      const file = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        'docs',
        'LLM_SPEC.md'
      );
      if (!fs.existsSync(file)) fail(`ガイドが見つかりません: ${file}`);
      process.stdout.write(fs.readFileSync(file, 'utf8'));
      return;
    }

    case 'docs': {
      const r = validate({ specsDir, schemaDir, openapiPath });
      const out = path.resolve(values.out ?? path.join(specsDir, '.mobilespec', 'docs'));
      const written = writeDocs(out, renderDocs(r.project, r.edges, r.openapi));
      console.log(`✅ ${written.length} ファイルを出力しました: ${out}`);
      return;
    }

    case 'export': {
      const r = validate({ specsDir, schemaDir, openapiPath });
      console.log(JSON.stringify(exportModel(r.project, r.edges, r.openapi), null, 2));
      return;
    }

    case 'migrate': {
      const r = runMigrate({ specsDir, to: values.to, openapiPath });
      if (!r.ok) fail(r.message);
      for (const p of r.problems) console.error(`⚠️ 読めませんでした: ${p}`);
      for (const n of r.report.notes) console.log(n);
      const counts = Object.entries(r.report.counts).sort(([a], [b]) => (a < b ? -1 : 1));
      for (const [k, n] of counts) console.log(`  ${k}: ${n}`);
      for (const t of r.report.todos) console.log(`TODO ${t}`);
      for (const l of r.validation.errors) console.error(l);
      console.log(r.validation.summary);
      console.log(
        r.written ? `✅ 書き出しました: ${r.written}` : '（dry-run: --to <dir> で書き出します）'
      );
      if (r.validation.errorCount > 0) process.exit(1);
      return;
    }

    case 'update': {
      const r = runUpdate({ specsDir, check: values.check });
      if (!r.ok) fail(r.message);
      if (values.check) {
        if (r.stale.length > 0) {
          for (const f of r.stale) console.error(`❌ 生成物が最新ではありません: ${f}`);
          console.error('mobilespec update を実行してください');
          process.exit(1);
        }
        console.log('✅ 生成物は最新です');
        return;
      }
      for (const f of r.written) console.log(`✅ 更新: ${f}`);
      if (r.written.length === 0) console.log('✅ 更新するものはありません（最新です）');
      return;
    }

    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.error(HELP);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
