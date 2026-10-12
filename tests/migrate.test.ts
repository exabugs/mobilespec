// tests/migrate.test.ts — 旧体系（架空の例）→ version 2 への変換
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runMigrate } from '../src/commands/migrate.js';
import { writeFile } from './helpers/mkSpec.js';
import { mkTempDir } from './helpers/mkTemp.js';

function oldProject(): string {
  const dir = mkTempDir('old-');
  writeFile(
    path.join(dir, 'mobilespec.config.yml'),
    `
mermaid:
  groupOrder: [main]
i18n:
  locales: [ja]
`
  );
  writeFile(
    path.join(dir, 'L2.guards.yaml'),
    `
guards:
  - id: loggedIn
    name: ログイン済み
`
  );
  writeFile(
    path.join(dir, 'L2.screenflows/main/home.flow.yaml'),
    `
# 最初の画面
screen:
  id: home
  name: ホーム
  entry: true
  transitions:
    - id: open_detail
      target: detail
`
  );
  writeFile(
    path.join(dir, 'L2.screenflows/main/detail.flow.yaml'),
    `
screen:
  id: detail
  name: 詳細
  transitions:
    - id: back
      target: home
`
  );
  writeFile(
    path.join(dir, 'L3.ui/home.ui.yaml'),
    `
screen:
  id: home
  layout:
    type: Column
    children:
      - id: open
        type: Button
        action: open_detail
`
  );
  writeFile(
    path.join(dir, 'L3.ui/detail.ui.yaml'),
    `
screen:
  id: detail
  layout:
    type: Column
    children:
      - id: back
        type: Button
        action: back
`
  );
  writeFile(
    path.join(dir, 'L4.state/home.state.yaml'),
    `
screen:
  id: home
  state:
    - name: count
      type: integer
      default: 0
  conditions:
    loggedIn: ログイン済みか
  events:
    - name: open_detail
      type: navigate
      targetScreenId: detail
`
  );
  return dir;
}

describe('migrate', () => {
  it('dry-run は元を変更せず、報告を返す', () => {
    const dir = oldProject();
    const before = fs.readdirSync(dir).sort();
    const r = runMigrate({ specsDir: dir });
    expect(r.ok).toBe(true);
    expect(fs.readdirSync(dir).sort()).toEqual(before);
    if (r.ok) {
      expect(r.report.notes[0]).toContain('2');
      expect(r.report.counts['navigate→L2に統合']).toBe(1);
    }
  });

  it('--to に書き出し、コメントを退避する', () => {
    const dir = oldProject();
    const to = path.join(mkTempDir('new-'), 'out');
    const r = runMigrate({ specsDir: dir, to });
    expect(r.ok).toBe(true);
    const app = fs.readFileSync(path.join(to, 'app.yaml'), 'utf8');
    expect(app).toContain('version: 2');
    expect(app).toContain('loggedIn');
    const home = fs.readFileSync(path.join(to, 'L2.screenflows/main/home.flow.yaml'), 'utf8');
    expect(home).toContain('x-legacyComments');
    expect(home).not.toContain('screen:');
  });

  it('書き出し先が空でなければ失敗する', () => {
    const dir = oldProject();
    const r = runMigrate({ specsDir: dir, to: mkTempDir('busy-') + '' });
    // mkdtemp は空のディレクトリを作るので成功する。中身があれば失敗
    expect(r.ok).toBe(true);
    const busy = mkTempDir('busy-');
    fs.writeFileSync(path.join(busy, 'x'), '');
    expect(runMigrate({ specsDir: dir, to: busy }).ok).toBe(false);
  });
});
