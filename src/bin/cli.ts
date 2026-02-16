#!/usr/bin/env node
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { generateI18n } from '../generateI18n.js';
import { generateMermaid } from '../generateMermaid.js';
import { openapiCheck } from '../openapiCheck.js';
import { errorsOf, infosOf, warningsOf } from '../types/diagnostic.js';
import type { DiagnosticLevel, HasDiagnostics } from '../types/diagnostic.js';
import { loadConfig } from '../validate/config.js';
import { validate } from '../validate/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SCHEMA_DIR = path.join(__dirname, '..', '..', 'schema');

type Args = {
  cmd: string;
  specsDir: string;
  schemaDir: string;
  failOnWarnings: boolean;
  openapiPath?: string;

  // openapi-check 専用（導入期用）
  warnUnusedOperationIdLevel?: DiagnosticLevel | 'off';
  checkSelectRoot?: boolean;
};

function getArg(args: string[], key: string): string | undefined {
  const i = args.indexOf(key);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  return undefined;
}

function has(args: string[], key: string) {
  return args.includes(key);
}

function parseLevelOrOff(s: string | undefined): DiagnosticLevel | 'off' | undefined {
  if (!s) return undefined;
  const v = s.trim().toLowerCase();
  if (v === 'off') return 'off';
  if (v === 'info' || v === 'warning' || v === 'error') return v;
  return undefined;
}

function parse(): Args {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? 'check';
  const specsDir = getArg(args, '--specs-dir') ?? process.cwd();
  const schemaDir = getArg(args, '--schema-dir') ?? DEFAULT_SCHEMA_DIR;

  // デフォルトは「warningで落とす」＝strict寄り
  let failOnWarnings = true;
  if (has(args, '--no-fail-on-warnings')) failOnWarnings = false;
  if (has(args, '--fail-on-warnings')) failOnWarnings = true;

  const openapiPath = getArg(args, '--openapi');

  // openapi-check のオプション
  // 互換:
  // - --warn-unused-operation-id            => 'warning'
  // - --warn-unused-operation-id info       => 'info'
  // - --warn-unused-operation-id off        => 'off'
  const warnUnusedFlag = has(args, '--warn-unused-operation-id');
  const warnUnusedArg = getArg(args, '--warn-unused-operation-id');
  const warnUnusedOperationIdLevel =
    parseLevelOrOff(warnUnusedArg) ?? (warnUnusedFlag ? 'warning' : undefined);

  const checkSelectRoot = has(args, '--check-select-root');

  return {
    cmd,
    specsDir,
    schemaDir,
    failOnWarnings,
    openapiPath,
    warnUnusedOperationIdLevel,
    checkSelectRoot,
  };
}

/**
 * Print errors/warnings and return exit code.
 * - errors > 0 => 1
 * - warnings > 0 and failOnWarnings => 1
 * - otherwise => 0
 */
function reportAndCode(result: HasDiagnostics, failOnWarnings: boolean): number {
  const errors = errorsOf(result);
  const warnings = warningsOf(result);
  const infos = infosOf(result);

  if (errors.length) {
    for (const e of errors) console.error(`❌ ${e.message}`);
    return 1;
  }

  if (warnings.length) {
    for (const w of warnings) console.warn(`⚠️ ${w.message}`);
    if (failOnWarnings) return 1;
  }

  if (infos.length) {
    for (const i of infos) console.log(`ℹ️ ${i.message}`);
  }

  return 0;
}

/**
 * Resolve openapi path:
 * - If absolute => keep
 * - If relative => resolve from specsDir (same rule as validate/index.ts)
 */
function resolveOpenapiPath(specsDir: string, raw: string): string {
  return path.isAbsolute(raw) ? raw : path.resolve(specsDir, raw);
}

async function main() {
  const a = parse();

  switch (a.cmd) {
    case 'validate': {
      const r = await validate({ specsDir: a.specsDir, schemaDir: a.schemaDir });
      const code = reportAndCode(r, a.failOnWarnings);
      if (code === 0) console.log('✅ validate OK');
      process.exit(code);
    }

    case 'mermaid': {
      await generateMermaid({ specsDir: a.specsDir, schemaDir: a.schemaDir });
      console.log('✅ mermaid OK');
      process.exit(0);
    }

    case 'i18n': {
      await generateI18n({ specsDir: a.specsDir, schemaDir: a.schemaDir });
      console.log('✅ i18n OK');
      process.exit(0);
    }

    case 'check': {
      const r = await validate({ specsDir: a.specsDir, schemaDir: a.schemaDir });
      const code = reportAndCode(r, a.failOnWarnings);
      if (code !== 0) process.exit(code);

      await generateMermaid({ specsDir: a.specsDir, schemaDir: a.schemaDir });
      await generateI18n({ specsDir: a.specsDir, schemaDir: a.schemaDir });
      console.log('✅ check OK');
      process.exit(0);
    }

    case 'openapi-check': {
      const cfg = loadConfig(a.specsDir);
      const raw =
        (typeof a.openapiPath === 'string' && a.openapiPath.trim() !== ''
          ? a.openapiPath
          : undefined) ??
        (typeof cfg.openapi?.path === 'string' && cfg.openapi.path.trim() !== ''
          ? cfg.openapi.path
          : undefined);

      if (!raw) {
        console.error('openapi-check requires --openapi <path> or config openapi.path');
        process.exit(1);
      }

      const resolved = resolveOpenapiPath(a.specsDir, raw);

      if (!fs.existsSync(resolved)) {
        console.error(`❌ OpenAPI が見つかりません: ${resolved}`);
        process.exit(1);
      }

      // デフォルトは導入期向け（unused/selectRoot は off）
      const warnUnusedOperationIdLevel = a.warnUnusedOperationIdLevel ?? 'off';
      const checkSelectRoot = a.checkSelectRoot ?? false;

      const r = await openapiCheck({
        specsDir: a.specsDir,
        schemaDir: a.schemaDir,
        openapiPath: resolved,
        warnUnusedOperationIdLevel,
        checkSelectRoot,
      });

      const code = reportAndCode(r, a.failOnWarnings);
      if (code === 0) console.log('✅ openapi-check OK');
      process.exit(code);
    }

    default: {
      console.error(`Unknown command: ${a.cmd}`);
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
