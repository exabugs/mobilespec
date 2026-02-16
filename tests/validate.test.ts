// tests/validate.test.ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { errorsOf, findByCode, warningsOf } from '../src/types/diagnostic.js';
import { validate } from '../src/validate/index.js';
import { writeFile } from './helpers/mkSpec.js';
import { mkTempDir } from './helpers/mkTemp.js';
import { writeOkSpec } from './helpers/okSpec.js';

const schemaDir = path.resolve(process.cwd(), 'schema');

describe('mobilespec validate (current behavior)', () => {
  it('ok: errors=[], warnings=[]', async () => {
    const specsDir = mkTempDir();
    writeOkSpec(specsDir);

    const r = await validate({ specsDir, schemaDir });

    expect(errorsOf(r)).toEqual([]);
    expect(warningsOf(r)).toEqual([]);
  });

  it('ng: L3 action typo => L3-L2 mismatch goes to errors', async () => {
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
`
    );

    const r = await validate({ specsDir, schemaDir });

    const errors = errorsOf(r);
    expect(errors.length).toBeGreaterThan(0);

    const error = findByCode(r, 'L3_ACTION_NOT_IN_L2');
    expect(error).toBeDefined();
    expect(error?.meta?.action).toBe('open_tasks_typo');
  });

  it('ng: L3 screen missing in L2 => goes to errors (L3_UNKNOWN_SCREEN)', async () => {
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
`
    );

    const r = await validate({ specsDir, schemaDir });

    const error = findByCode(r, 'L3_UNKNOWN_SCREEN');
    expect(error).toBeDefined();
    expect(error?.meta?.screenId).toBe('home_typo');
  });

  it('ng: L2 transition missing in L4.events => goes to warnings (L2_TRANSITION_NOT_IN_L4)', async () => {
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
`
    );

    const r = await validate({ specsDir, schemaDir });

    const warn = findByCode(r, 'L2_TRANSITION_NOT_IN_L4');
    expect(warn).toBeDefined();
  });

  it('ng: unused L2 transition => goes to warnings (L2_TRANSITION_UNUSED)', async () => {
    const specsDir = mkTempDir();
    const { l2, l4 } = writeOkSpec(specsDir);

    // OK を 1点だけ壊す：L2に「未使用transition」を追加（L3は触らないので未使用になる）
    writeFile(
      path.join(l2, 'home.flow.yaml'),
      `
screen:
  id: home
  name: ホーム
  type: screen
  entry: true
  transitions:
    - id: open_tasks
      trigger: tap
      target: tasks
    - id: unused_transition
      trigger: tap
      target: tasks
`
    );

    // 余計な warning を避けるため、L4.events にも unused_transition を用意しておく
    writeFile(
      path.join(l4, 'home.state.yaml'),
      `
screen:
  id: home
  events:
    open_tasks:
      type: navigate
      targetScreenId: tasks
    unused_transition:
      type: navigate
      targetScreenId: tasks
`
    );

    const r = await validate({ specsDir, schemaDir });

    // error は出ない（warning のみ）
    expect(errorsOf(r)).toEqual([]);

    const warn = findByCode(r, 'L2_TRANSITION_UNUSED');
    expect(warn).toBeDefined();
    expect(warn?.meta?.transitionId).toBe('unused_transition');
  });

  it('ng: i18n untranslated => goes to warnings (I18N_UNTRANSLATED)', async () => {
    const specsDir = mkTempDir();
    writeOkSpec(specsDir);

    // i18n を用意（ja は埋める、en は空）
    writeFile(
      path.join(specsDir, 'i18n', 'ja.json'),
      JSON.stringify(
        {
          'app.screen.home.title': 'ホーム',
          'app.screen.home.component.action_open_tasks.label': '未処理タスク',
        },
        null,
        2
      ) + '\n'
    );
    writeFile(
      path.join(specsDir, 'i18n', 'en.json'),
      JSON.stringify(
        {
          'app.screen.home.title': '',
          'app.screen.home.component.action_open_tasks.label': '',
        },
        null,
        2
      ) + '\n'
    );

    const r = await validate({ specsDir, schemaDir });

    const warn = findByCode(r, 'I18N_UNTRANSLATED');
    expect(warn).toBeDefined();
  });
});
