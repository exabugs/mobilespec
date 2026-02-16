// tests/openapiCheck.test.ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { openapiCheck } from '../src/openapiCheck.js';
import { errorsOf, findByCode, infosOf, warningsOf } from '../src/types/diagnostic.js';
import { writeFile } from './helpers/mkSpec.js';
import { mkTempDir } from './helpers/mkTemp.js';
import { writeOkForOpenApi } from './helpers/openapiSpec.js';

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
  it('ok: errors=[], infos=[]', async () => {
    const ctx = setup();
    const r = await run(ctx);

    expect(errorsOf(r)).toEqual([]);
    expect(infosOf(r)).toEqual([]);

    // policy: warnings are not used
    expect(warningsOf(r)).toEqual([]);
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
`
    );

    const r = await run(ctx);
    const errors = errorsOf(r);
    expect(errors.length).toBeGreaterThan(0);

    const error = findByCode(r, 'L4_UNKNOWN_OPERATION_ID');
    expect(error).toBeDefined();
    expect(error?.message).toContain('getTasks_typo');
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
`
    );

    const r = await run(ctx);
    const errors = errorsOf(r);
    expect(errors.length).toBeGreaterThan(0);

    const error = findByCode(r, 'OPENAPI_MISSING_OPERATION_ID');
    expect(error).toBeDefined();
  });

  it('info: OpenAPI operationId unused by L4 => info', async () => {
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
`
    );

    const r = await run(ctx);

    expect(errorsOf(r)).toEqual([]);

    const infos = infosOf(r);
    expect(infos.length).toBeGreaterThan(0);

    const info = findByCode(r, 'L4_UNUSED_OPERATION_ID');
    expect(info).toBeDefined();
    expect(info?.message).toContain('getUsers');

    // policy: warnings are not used
    expect(warningsOf(r)).toEqual([]);
  });

  it('ng: L4 includes selectRoot but OpenAPI schema unresolved => error', async () => {
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
`
    );

    const r = await run(ctx);
    const error = findByCode(r, 'OPENAPI_RESPONSE_SCHEMA_UNRESOLVED');
    expect(error).toBeDefined();
    expect(infosOf(r)).toEqual([]);

    // policy: warnings are not used
    expect(warningsOf(r)).toEqual([]);
  });
});
