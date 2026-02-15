// tests/validate.test.ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';

import { validate } from '../src/validate/index.js';
import { mkTempDir } from './helpers/mkTemp.js';
import { writeOkSpec } from './helpers/okSpec.js';
import { writeFile } from './helpers/mkSpec.js';

const schemaDir = path.resolve(process.cwd(), 'schema');

describe('mobilespec validate (current behavior)', () => {
  it('ok: errors=[], warnings=[]', () => {
    const specsDir = mkTempDir();
    writeOkSpec(specsDir);

    const r = validate({ specsDir, schemaDir });

    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('ng: L3 action typo => L3-L2 mismatch goes to errors', () => {
    const specsDir = mkTempDir();
    const { l3 } = writeOkSpec(specsDir);

    // OK を 1点だけ壊す：action が L2.transition.id に存在しない
    writeFile(
      path.join(l3, 'home.ui.yaml'),
      `
screen:
  id: home
  layout:
    type: column
    children:
      - component: Button
        id: action_open_tasks
        name: 未処理タスク
        action: open_tasks_typo
`,
    );

    const r = validate({ specsDir, schemaDir });

    // 現状実装のメッセージに合わせる（prefix一致）
    expect(r.errors.join('\n')).toContain('❌ L3-L2不整合');
  });
});
