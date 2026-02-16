#!/usr/bin/env node

// src/bin/cli.ts
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { generateI18n } from '../generateI18n.js';
import { generateMermaid } from '../generateMermaid.js';
import { openapiCheck } from '../openapiCheck.js';
import { errorsOf, infosOf } from '../types/diagnostic.js';
import type { HasDiagnostics } from '../types/diagnostic.js';
import { loadConfig } from '../validate/config.js';
import { validate } from '../validate/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SCHEMA_DIR = path.join(__dirname, '..', '..', 'schema');

type Args = {
  cmd: string;
  specsDir: string;
  schemaDir: string;
  openapiPath?: string;
};

function getArg(args: string[], key: string): string | undefined {
  const i = args.indexOf(key);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  return undefined;
}

function parse(): Args {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? 'check';
  const specsDir = getArg(args, '--specs-dir') ?? process.cwd();
  const schemaDir = getArg(args, '--schema-dir') ?? DEFAULT_SCHEMA_DIR;
  const openapiPath = getArg(args, '--openapi');
  return { cmd, specsDir, schemaDir, openapiPath };
}

function reportAndCode(result: HasDiagnostics): number {
  const errors = errorsOf(result);
  const infos = infosOf(result);

  for (const e of errors) console.error(`❌ ${e.message}`);
  for (const i of infos) console.log(`ℹ️ ${i.message}`);

  return errors.length ? 1 : 0;
}

function resolveOpenapiPath(specsDir: string, raw: string): string {
  return path.isAbsolute(raw) ? raw : path.resolve(specsDir, raw);
}

async function main() {
  const a = parse();

  switch (a.cmd) {
    case 'validate': {
      const r = await validate({ specsDir: a.specsDir, schemaDir: a.schemaDir });
      const code = reportAndCode(r);
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
      const code = reportAndCode(r);
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

      const r = await openapiCheck({
        specsDir: a.specsDir,
        schemaDir: a.schemaDir,
        openapiPath: resolved,
      });

      const code = reportAndCode(r);
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
