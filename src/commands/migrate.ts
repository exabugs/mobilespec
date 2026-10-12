// src/commands/migrate.ts — 旧体系（1.x）の仕様を、新体系（version 2）に変換する
//
// 既定は dry-run: 一時ディレクトリに変換結果を作り、update と check をかけて報告する（元は変更しない）。
// --to <dir> を付けると、その空のディレクトリに書き出す。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { asObj } from '../core/model.js';
import { loadOpenApi } from '../core/openapi.js';
import { type MigrateReport, convertProject } from '../migrate/convert.js';
import { readOldProject } from '../migrate/read.js';
import { resolveOpenapiPath } from '../openapiPath.js';
import { buildReport } from '../report.js';
import { validate } from '../validate.js';
import { runUpdate } from './update.js';

export type MigrateOptions = {
  specsDir: string;
  /** 書き出し先。省略すると dry-run（一時ディレクトリで検証して消す） */
  to?: string;
  openapiPath?: string;
};

export type MigrateResult =
  | {
      ok: true;
      report: MigrateReport;
      /** 変換後の仕様の検証結果（レポート） */
      validation: { errors: string[]; summary: string; errorCount: number };
      problems: string[];
      written?: string;
    }
  | { ok: false; message: string };

export function runMigrate(options: MigrateOptions): MigrateResult {
  const old = readOldProject(options.specsDir);
  if (old.screens.size === 0) {
    return { ok: false, message: `旧体系の画面が見つかりません: ${options.specsDir}` };
  }
  const configOpenapi = asObj(old.config.openapi).path;
  const openapiAbs =
    options.openapiPath ??
    (typeof configOpenapi === 'string'
      ? resolveOpenapiPath(options.specsDir, configOpenapi, false)
      : undefined);
  const loaded = openapiAbs && fs.existsSync(openapiAbs) ? loadOpenApi(openapiAbs) : undefined;
  const index = loaded?.ok ? loaded.index : undefined;

  const dest = options.to
    ? path.resolve(options.to)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'mobilespec-migrate-'));
  if (options.to && fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
    return { ok: false, message: `書き出し先が空ではありません: ${dest}` };
  }

  try {
    const result = convertProject(old, index, {
      openapiRel: openapiAbs ? path.relative(dest, openapiAbs) : undefined,
      newDir: dest,
    });
    for (const [rel, content] of result.files) {
      const abs = path.join(dest, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    for (const rel of old.passthrough) {
      const abs = path.join(dest, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.copyFileSync(path.join(old.dir, rel), abs);
    }
    const upd = runUpdate({ specsDir: dest });
    const v = validate({ specsDir: dest, openapiPath: openapiAbs });
    const rep = buildReport(v.diagnostics, { verbose: false });
    if (!upd.ok) result.report.todos.push(`生成物の更新に失敗: ${upd.message}`);
    return {
      ok: true,
      report: result.report,
      validation: { errors: rep.errors, summary: rep.summary, errorCount: rep.errorCount },
      problems: old.problems,
      ...(options.to && { written: dest }),
    };
  } finally {
    if (!options.to) fs.rmSync(dest, { recursive: true, force: true });
  }
}
