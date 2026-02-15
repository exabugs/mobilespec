// tests/validate.test.ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';

import { validate } from '../src/validate/index.js';
import { mkTempDir } from './helpers/mkTemp.js';
import { writeOkSpec } from './helpers/okSpec.js';
import { writeFile } from './helpers/mkSpec.js';
import { errorsOf, warningsOf, findByCode } from '../src/types/diagnostic.js';

const schemaDir = path.resolve(process.cwd(), 'schema');

describe('mobilespec validate (current behavior)', () => {
  it('ok: errors=[], warnings=[]', () => {
    const specsDir = mkTempDir();
    writeOkSpec(specsDir);

    const r = validate({ specsDir, schemaDir });

    expect(errorsOf(r)).toEqual([]);
    expect(warningsOf(r)).toEqual([]);
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

    const errors = errorsOf(r);
    expect(errors.length).toBeGreaterThan(0);

    const error = findByCode(r, 'L3_ACTION_NOT_IN_L2');
    expect(error).toBeDefined();
    expect(error?.meta?.action).toBe('open_tasks_typo');
  });

  it('ng: L3 screen missing in L2 => goes to errors (L3_UNKNOWN_SCREEN)', () => {
    const specsDir = mkTempDir();
    const { l3 } = writeOkSpec(specsDir);

    // OK を 1点だけ壊す：L3のscreen.idをL2に無いものにする
    writeFile(
      path.join(l3, 'home.ui.yaml'),
      `
screen:
  id: home_typo
  layout:
    type: column
    children:
      - component: Button
        id: action_open_tasks
        name: 未処理タスク
        action: open_tasks_unfinished
`,
    );

    const r = validate({ specsDir, schemaDir });

    const error = findByCode(r, 'L3_UNKNOWN_SCREEN');
    expect(error).toBeDefined();
    expect(error?.meta?.screenId).toBe('home_typo');
  });

  it('ng: L2 transition missing in L4.events => goes to warnings (L2_TRANSITION_NOT_IN_L4)', () => {
    const specsDir = mkTempDir();
    const { l4 } = writeOkSpec(specsDir);

    // OK を 1点だけ壊す：L4側の events から 1つ消す
    writeFile(
      path.join(l4, 'home.state.yaml'),
      `
screen:
  id: home
  data:
    queries: {}
    mutations: {}
  events: {}
`,
    );

    const r = validate({ specsDir, schemaDir });

    const warn = findByCode(r, 'L2_TRANSITION_NOT_IN_L4');
    expect(warn).toBeDefined();
  });
});
