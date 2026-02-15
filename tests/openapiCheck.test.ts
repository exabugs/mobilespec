// tests/openapiCheck.test.ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';

import { mkTempDir } from './helpers/mkTemp.js';
import { writeOkForOpenApi } from './helpers/openapiSpec.js';
import { writeFile } from './helpers/mkSpec.js';

import { openapiCheck } from '../src/openapiCheck.js';

const schemaDir = path.resolve(process.cwd(), 'schema');

type Ctx = {
  specsDir: string;
  openapiPath: string;
};

function setup(): Ctx {
  const specsDir = mkTempDir();
  const openapiPath = path.join(specsDir, 'openapi.yaml');
  writeOkForOpenApi(specsDir, openapiPath);
  return { specsDir, openapiPath };
}

async function run(ctx: Ctx) {
  return openapiCheck({
    specsDir: ctx.specsDir,
    schemaDir,
    openapiPath: ctx.openapiPath,
  });
}

describe('openapiCheck', () => {
  it('ok: errors=[], warnings=[]', async () => {
    const ctx = setup();
    const r = await run(ctx);

    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('ng: L4 references unknown operationId => error', async () => {
    const ctx = setup();

    // OK を 1点だけ壊す：L4 の operationId を typo
    writeFile(
      path.join(ctx.specsDir, 'L4.state', 'home.state.yaml'),
      `
screen:
  id: home
  data:
    queries:
      load_tasks:
        operationId: getTasks_typo
`,
    );

    const r = await run(ctx);
    expect(r.errors.join('\n')).toContain('🔴 L4 が存在しない operationId を参照');
  });

  it('ng: OpenAPI has missing operationId => error', async () => {
    const ctx = setup();

    // OpenAPI を 1点だけ壊す：operationId を消す
    writeFile(
      ctx.openapiPath,
      `
openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths:
  /tasks:
    get:
      responses:
        "200":
          description: ok
`,
    );

    const r = await run(ctx);
    expect(r.errors.join('\n')).toContain('🔴 OpenAPI に operationId が無い operation');
  });

  it('warn: OpenAPI operationId unused by L4 => warning', async () => {
    const ctx = setup();

    // OpenAPI に未参照の operationId を追加
    writeFile(
      ctx.openapiPath,
      `
openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths:
  /tasks:
    get:
      operationId: getTasks
      responses:
        "200":
          description: ok
  /users:
    get:
      operationId: getUsers
      responses:
        "200":
          description: ok
`,
    );

    const r = await run(ctx);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join('\n')).toContain('⚠️ OpenAPI operationId が L4 から未参照');
  });

  it('ok: L4 includes selectRoot (allowed by L4 JSON Schema)', async () => {
    const ctx = setup();

    // AJV（L4.schema.json）に統一したので selectRoot は “invalid” ではない
    writeFile(
      path.join(ctx.specsDir, 'L4.state', 'home.state.yaml'),
      `
screen:
  id: home
  data:
    queries:
      load_tasks:
        operationId: getTasks
        selectRoot: tasks
`,
    );

    const r = await run(ctx);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});
