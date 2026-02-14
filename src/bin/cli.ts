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

import path from 'path';
import { fileURLToPath } from 'url';
import { validate } from '../validate.js';
import { generateMermaid } from '../generateMermaid.js';
import { generateI18n } from '../generateI18n.js';
import { openapiCheck } from '../openapiCheck.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SCHEMA_DIR = path.join(__dirname, '..', '..', 'schema');

type Args = {
  cmd: string;
  specsDir: string;
  schemaDir: string;
  failOnWarnings: boolean;
  openapiPath?: string;
};

function getArg(args: string[], key: string): string | undefined {
  const i = args.indexOf(key);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  return undefined;
}
function has(args: string[], key: string) {
  return args.includes(key);
}

function parse(): Args {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? 'check';
  const specsDir = getArg(args, '--specs-dir') ?? process.cwd();
  const schemaDir = getArg(args, '--schema-dir') ?? DEFAULT_SCHEMA_DIR;

  let failOnWarnings = true;
  if (has(args, '--no-fail-on-warnings')) failOnWarnings = false;
  if (has(args, '--fail-on-warnings')) failOnWarnings = true;

  const openapiPath = getArg(args, '--openapi');
  return { cmd, specsDir, schemaDir, failOnWarnings, openapiPath };
}

function exitWith(result: { errors: string[]; warnings: string[] }, failOnWarnings: boolean) {
  if (result.errors.length) {
    for (const e of result.errors) console.error(e);
    process.exit(1);
  }
  if (result.warnings.length) {
    for (const w of result.warnings) console.warn(w);
    if (failOnWarnings) process.exit(1);
  }
}

async function main() {
  const a = parse();

  switch (a.cmd) {
    case 'validate': {
      const r = await validate({ specsDir: a.specsDir, schemaDir: a.schemaDir });
      exitWith(r, a.failOnWarnings);
      console.log('✅ validate OK');
      return;
    }
    case 'mermaid': {
      await generateMermaid({ specsDir: a.specsDir, schemaDir: a.schemaDir });
      console.log('✅ mermaid OK');
      return;
    }
    case 'i18n': {
      await generateI18n({ specsDir: a.specsDir, schemaDir: a.schemaDir });
      console.log('✅ i18n OK');
      return;
    }
    case 'check': {
      const r = await validate({ specsDir: a.specsDir, schemaDir: a.schemaDir });
      exitWith(r, a.failOnWarnings);
      await generateMermaid({ specsDir: a.specsDir, schemaDir: a.schemaDir });
      await generateI18n({ specsDir: a.specsDir, schemaDir: a.schemaDir });
      console.log('✅ check OK');
      return;
    }
    case 'openapi-check': {
      if (!a.openapiPath) {
        console.error('openapi-check requires --openapi <path>');
        process.exit(1);
      }
      const r = await openapiCheck({
        specsDir: a.specsDir,
        schemaDir: a.schemaDir,
        openapiPath: a.openapiPath,
      });
      exitWith(r, a.failOnWarnings);
      console.log('✅ openapi-check OK');
      return;
    }
    default:
      console.error(`Unknown command: ${a.cmd}`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
