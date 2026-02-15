// tests/openapiCheck.test.ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';

import { mkTempDir } from './helpers/mkTemp.js';
import { writeOkForOpenApi } from './helpers/openapiSpec.js';
import { writeFile } from './helpers/mkSpec.js';

// openapiCheck の import は、あなたの src 側の export 構造に合わせて調整してください。
// 例1) src/openapiCheck.ts がある場合:
import { openapiCheck } from '../src/openapiCheck.js';
// 例2) もし index.ts から export しているなら:
// import { openapiCheck } from "../src/index.js";

describe('openapiCheck (current behavior)', () => {
  it('ok: errors=[], warnings=[]', async () => {
    const specsDir = mkTempDir();
    const openapiPath = path.join(specsDir, 'openapi.yaml');

    writeOkForOpenApi(specsDir, openapiPath);

    const r = await openapiCheck({
      specsDir,
      schemaDir: 'unused',
      openapiPath,
    });

    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('ng: L4 references unknown operationId => error', async () => {
    const specsDir = mkTempDir();
    const openapiPath = path.join(specsDir, 'openapi.yaml');

    writeOkForOpenApi(specsDir, openapiPath);

    // OK を 1点だけ壊す：L4 の operationId を typo
    writeFile(
      path.join(specsDir, 'L4.state', 'home.state.yaml'),
      `
screen:
  id: home
  data:
    queries:
      load_tasks:
        operationId: getTasks_typo
`,
    );

    const r = await openapiCheck({
      specsDir,
      schemaDir: 'unused',
      openapiPath,
    });

    expect(r.errors.join('\n')).toContain('🔴 L4 が存在しない operationId を参照');
  });

  it('ng: OpenAPI has missing operationId => error', async () => {
    const specsDir = mkTempDir();
    const openapiPath = path.join(specsDir, 'openapi.yaml');

    // L4 は OK を書く
    writeOkForOpenApi(specsDir, openapiPath);

    // OpenAPI を 1点だけ壊す：operationId を消す
    writeFile(
      openapiPath,
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

    const r = await openapiCheck({
      specsDir,
      schemaDir: 'unused',
      openapiPath,
    });

    expect(r.errors.join('\n')).toContain('🔴 OpenAPI に operationId が無い operation');
  });

  it('warn: OpenAPI operationId unused by L4 => warning', async () => {
    const specsDir = mkTempDir();
    const openapiPath = path.join(specsDir, 'openapi.yaml');

    writeOkForOpenApi(specsDir, openapiPath);

    // OpenAPI に未参照の operationId を追加
    writeFile(
      openapiPath,
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

    const r = await openapiCheck({
      specsDir,
      schemaDir: 'unused',
      openapiPath,
    });

    expect(r.errors).toEqual([]);
    expect(r.warnings.join('\n')).toContain('⚠️ OpenAPI operationId が L4 から未参照');
  });

  it('ng: L4 includes selectRoot => error (strict schema)', async () => {
    const specsDir = mkTempDir();
    const openapiPath = path.join(specsDir, 'openapi.yaml');

    writeOkForOpenApi(specsDir, openapiPath);

    // openapiCheck 側の L4 Zod は strictObject({operationId}) なので selectRoot は “invalid”
    writeFile(
      path.join(specsDir, 'L4.state', 'home.state.yaml'),
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

    const r = await openapiCheck({
      specsDir,
      schemaDir: 'unused',
      openapiPath,
    });

    expect(r.errors.join('\n')).toContain('🔴 L4 invalid');
  });
});
