// tests/helpers/okSpec.ts
import path from 'node:path';

import { mkSpecDir, writeFile } from './mkSpec.js';

/**
 * 現状の実装・スキーマに一致する最小OKセットを生成
 *
 * - L2: required transitions を満たす（tasks も transitions: [] が必須）
 * - L3: screen.layout 必須、node は component/id/name 必須
 * - L4: screen.id 必須（他は任意）
 * - warnings を出さない構成：
 *   - home は entry=true（遷移元なし warning を回避）
 *   - tasks は exit=true（遷移先なし warning を回避）
 *   - L4.events のキー(open_tasks)は、home の L2.transition.id に存在
 */
export function writeOkSpec(specsDir: string) {
  const { l2, l3, l4 } = mkSpecDir(specsDir);
  const i18n = path.join(specsDir, 'i18n');

  // L2
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
`
  );

  writeFile(
    path.join(l2, 'tasks.flow.yaml'),
    `
screen:
  id: tasks
  name: タスク
  type: screen
  exit: true
  transitions: []
`
  );

  // L3（layout 必須）
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
        action: open_tasks
`
  );

  // L4（screen.id 必須。events は任意）
  writeFile(
    path.join(l4, 'home.state.yaml'),
    `
screen:
  id: home
  events:
    open_tasks:
      type: navigate
      targetScreenId: tasks
`
  );

  writeFile(
    path.join(i18n, 'ja.json'),
    JSON.stringify(
      {
        'app.screen.home.title': 'ホーム',
        'app.screen.tasks.title': 'タスク',
        'app.screen.home.component.action_open_tasks.label': '未処理タスク',
      },
      null,
      2
    ) + '\n'
  );

  writeFile(
    path.join(i18n, 'en.json'),
    JSON.stringify(
      {
        'app.screen.home.title': 'Home',
        'app.screen.tasks.title': 'Tasks',
        'app.screen.home.component.action_open_tasks.label': 'Open Tasks',
      },
      null,
      2
    ) + '\n'
  );

  return { l2, l3, l4 };
}
