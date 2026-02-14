#!/usr/bin/env node

/**
 * CLI Entry Point for mobilespec (SDD)
 *
 * Usage:
 *   mobilespec validate [--specs-dir <path>] [--schema-dir <path>] [--fail-on-warnings|--no-fail-on-warnings]
 *   mobilespec mermaid  [--specs-dir <path>] [--schema-dir <path>]
 *   mobilespec i18n     [--specs-dir <path>] [--schema-dir <path>]
 *   mobilespec check    [--specs-dir <path>] [--schema-dir <path>] [--fail-on-warnings|--no-fail-on-warnings]
 *   mobilespec openapi-check --openapi <path> [--specs-dir <path>] [--schema-dir <path>] [--fail-on-warnings|--no-fail-on-warnings]
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { validate } from '../validate.js';
import { generateMermaid } from '../generateMermaid.js';
import { generateI18n } from '../generateI18n.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default schema directory is relative to this file (dist/bin/cli.js -> dist -> schema)
const DEFAULT_SCHEMA_DIR = path.join(__dirname, '..', '..', 'schema');

type ParsedArgs = {
  command: string;
  specsDir: string;
  schemaDir: string;
  failOnWarnings: boolean;
  openapiPath?: string;
};

function getArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

// Parse command line arguments
function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const command = args[0] || 'validate';

  const specsDir = getArgValue(args, '--specs-dir') ?? process.cwd();
  const schemaDir = getArgValue(args, '--schema-dir') ?? DEFAULT_SCHEMA_DIR;

  // Default: true (SDD 推奨)
  let failOnWarnings = true;
  if (hasFlag(args, '--no-fail-on-warnings')) failOnWarnings = false;
  if (hasFlag(args, '--fail-on-warnings')) failOnWarnings = true;

  const openapiPath = getArgValue(args, '--openapi');

  return { command, specsDir, schemaDir, failOnWarnings, openapiPath };
}

function printUsage(): void {
  console.error(
    [
      'Usage:',
      '  mobilespec validate [--specs-dir <path>] [--schema-dir <path>] [--fail-on-warnings|--no-fail-on-warnings]',
      '  mobilespec mermaid  [--specs-dir <path>] [--schema-dir <path>]',
      '  mobilespec i18n     [--specs-dir <path>] [--schema-dir <path>]',
      '  mobilespec check    [--specs-dir <path>] [--schema-dir <path>] [--fail-on-warnings|--no-fail-on-warnings]',
      '  mobilespec openapi-check --openapi <path> [--specs-dir <path>] [--schema-dir <path>] [--fail-on-warnings|--no-fail-on-warnings]',
    ].join('\n'),
  );
}

function reportValidation(result: ReturnType<typeof validate>, failOnWarnings: boolean): void {
  if (result.errors.length > 0) {
    console.error('\n🔴 バリデーションエラー:');
    for (const err of result.errors) console.error(`  ${err}`);
    process.exit(1);
  }

  if (result.warnings.length > 0) {
    console.warn('\n⚠️  バリデーション警告:');
    for (const warn of result.warnings) console.warn(`  ${warn}`);

    if (failOnWarnings) {
      console.error('\n🔴 fail-on-warnings が有効なため、警告をエラー扱いにします。');
      process.exit(1);
    }
  }

  console.log(`\n✅ バリデーション成功`);
  console.log(`   screens: ${result.screens.size}`);
  console.log(`   transitions: ${result.transitions.length}`);
  console.log(`   ui actions: ${result.uiActions.length}`);
  console.log(`   state screens: ${result.stateScreens.size}`);
}

async function runOpenapiCheck(options: {
  specsDir: string;
  schemaDir: string;
  openapiPath: string;
  failOnWarnings: boolean;
}) {
  // 将来実装するモジュール（例：src/openapiCheck.ts -> dist/openapiCheck.js）
  // まだ未実装なら “I/F は固定しつつ” 明確に失敗させる（CIで気付ける）
  try {
    const mod = await import('../openapiCheck.js');
    if (typeof mod.openapiCheck !== 'function') {
      throw new Error(
        'openapiCheck.js は存在しますが、export const openapiCheck が見つかりません。',
      );
    }

    const result = await mod.openapiCheck({
      specsDir: options.specsDir,
      schemaDir: options.schemaDir,
      openapiPath: options.openapiPath,
    });

    // result 形式は validate と合わせる想定（errors/warnings）
    if (result?.errors?.length) {
      console.error('\n🔴 OpenAPI チェックエラー:');
      for (const err of result.errors) console.error(`  ${err}`);
      process.exit(1);
    }
    if (result?.warnings?.length) {
      console.warn('\n⚠️  OpenAPI チェック警告:');
      for (const warn of result.warnings) console.warn(`  ${warn}`);
      if (options.failOnWarnings) {
        console.error('\n🔴 fail-on-warnings が有効なため、警告をエラー扱いにします。');
        process.exit(1);
      }
    }

    console.log('\n✅ OpenAPI チェック成功');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('\n❌ openapi-check はまだ実装されていません（または読み込みに失敗しました）。');
    console.error(`   details: ${msg}`);
    process.exit(1);
  }
}

async function main() {
  try {
    const { command, specsDir, schemaDir, failOnWarnings, openapiPath } = parseArgs();
    const options = { specsDir, schemaDir };

    switch (command) {
      case 'validate': {
        const result = validate(options);
        reportValidation(result, failOnWarnings);
        break;
      }

      case 'mermaid': {
        await generateMermaid(options);
        break;
      }

      case 'i18n': {
        await generateI18n(options);
        break;
      }

      case 'check': {
        // CI 向け：一発で全部
        const result = validate(options);
        reportValidation(result, failOnWarnings);
        await generateMermaid(options);
        await generateI18n(options);
        break;
      }

      case 'openapi-check': {
        if (!openapiPath) {
          console.error('❌ openapi-check には --openapi <path> が必要です。');
          printUsage();
          process.exit(1);
        }
        await runOpenapiCheck({ specsDir, schemaDir, openapiPath, failOnWarnings });
        break;
      }

      default: {
        console.error(`❌ Unknown command: ${command}`);
        printUsage();
        process.exit(1);
      }
    }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
