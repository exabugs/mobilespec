// tests/helpers/openapiSpec.ts
import path from 'node:path';

import { mkSpecDir, writeFile } from './mkSpec.js';

/**
 * openapiCheck.ts の “OK” 最小セットを生成
 * - specsDir/L4.state/*.state.yaml に operationId 参照を書く
 * - openapiPath に paths + operationId を持つ OpenAPI YAML を書く
 *
 * 注意:
 * openapiCheck の L4 パーサは Zod strict なので、L4 の query/mutation は
 * { operationId } 以外を書かない（selectRoot 禁止）。
 */
export function writeOkForOpenApi(specsDir: string, openapiPath: string) {
  const { l4 } = mkSpecDir(specsDir);

  // L4: operationId 参照（selectRoot は書かない！）
  writeFile(
    path.join(l4, 'home.state.yaml'),
    `
screen:
  id: home
  data:
    queries:
      load_tasks:
        operationId: getTasks
`
  );

  // OpenAPI: operationId を供給
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
`
  );

  return { l4 };
}
