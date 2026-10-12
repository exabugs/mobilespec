// tests/helpers/okProject.ts — 検証を通る最小のプロジェクト（新体系）。一部だけ壊して負例にする
import fs from 'node:fs';
import path from 'node:path';

import { expectedJa } from '../../src/core/derive.js';
import { loadProject } from '../../src/core/load.js';
import { mkTempDir } from './mkTemp.js';

export function write(root: string, rel: string, content: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.replace(/^\n/, ''), 'utf8');
}

export const FILES: Record<string, string> = {
  'app.yaml': `
version: 2
groups: [home, item]
locales: [ja, en]
openapi: ./openapi.yaml
facts:
  isSignedIn: { description: サインイン済み }
`,
  'openapi.yaml': `
openapi: 3.0.3
info: { title: test, version: '1' }
paths:
  /items/{id}:
    get:
      operationId: getItem
      summary: 項目を取得する
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Item' }
  /items/{id}/members/me:
    get:
      operationId: getMyStatus
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { type: boolean }
    put:
      operationId: joinItem
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '204': { description: ok }
components:
  schemas:
    Item:
      type: object
      required: [id]
      properties:
        id: { type: string }
        title: { type: string }
        members: { type: array, items: { type: string } }
`,
  'L2.screenflows/home/home.flow.yaml': `
name: ホーム
group: home
entry: true
summary: 起動直後の画面
description: 項目の一覧への入口。
transitions:
  - id: open_item
    target: item_detail
    params: { id: item-1 }
`,
  'L2.screenflows/item/item_detail.flow.yaml': `
name: 項目の詳細
group: item
summary: 項目の詳細と参加の操作
description: 項目の詳細を見せ、参加の操作ができる。
params:
  - { name: id, type: string, required: true, description: 項目の ID }
transitions:
  - id: open_members
    target: item_members
    params: { id: $params.id }
  - id: after_join
    target: item_members
    params: { id: $params.id }
    description: 参加の完了後
  - id: open_share
    target: external
  - id: back_home
    target: home
`,
  'L2.screenflows/item/item_members.flow.yaml': `
name: メンバー
group: item
summary: メンバー一覧
description: 項目のメンバーを見せる。
params:
  - { name: id, type: string, required: true, description: 項目の ID }
transitions: []
`,
  'L3.ui/home.ui.yaml': `
layout:
  type: column
  children:
    - { component: Button, id: btn_open, name: 項目を開く, action: open_item }
`,
  'L3.ui/item_detail.ui.yaml': `
layout:
  type: column
  children:
    - { component: Button, id: btn_members, name: メンバーを見る, action: open_members }
    - { component: Button, id: btn_join, name: 参加する, action: join, unavailable: hide }
    - { component: Text, id: txt_empty, name: メンバーはまだいません, visibleWhen: noMembers }
    - { component: Button, id: btn_home, name: ホームへ, action: back_home }
headerRight:
  - component: IconButton
    id: btn_more
    name: メニュー
    menu: [{ id: menu_share, label: 共有, action: open_share }]
`,
  'L3.ui/item_members.ui.yaml': `
layout:
  type: column
  children:
    - { component: Text, id: txt_title, name: メンバー一覧 }
`,
  'L4.state/item_detail.state.yaml': `
data:
  queries:
    item: { operationId: getItem, args: { id: $params.id } }
    myStatus: { operationId: getMyStatus, args: { id: $params.id } }
  mutations:
    join: { operationId: joinItem, args: { id: $params.id } }
state:
  - { name: tab, type: string, enum: [info, members], default: info, description: 表示中のタブ }
conditions:
  noMembers: { expr: item.data.members.length == 0, description: メンバーがいない }
  canJoin:
    expr: '!myStatus.data && !item.isPending && isSignedIn'
    description: メンバーでなく、取得済み、サインイン済み
events:
  join:
    when: canJoin
    description: 参加する
    steps:
      - mutate: join
      - refetch: [myStatus]
      - set: { tab: members }
      - go: after_join
`,
};

/** 有効なプロジェクトを作る。overrides で上書き（null で削除） */
export function makeProject(overrides: Record<string, string | null> = {}): string {
  const root = mkTempDir('mobilespec-v2-');
  const files = { ...FILES, ...overrides };
  for (const [rel, content] of Object.entries(files)) {
    if (content !== null) write(root, rel, content);
  }
  // 生成物（ja.json）: update と同じ内容。overrides の後の仕様から導く
  const ja = Object.fromEntries(expectedJa(loadProject(root)));
  if (!('i18n/ja.json' in overrides))
    write(root, 'i18n/ja.json', JSON.stringify(ja, null, 2) + '\n');
  if (!('i18n/en.json' in overrides)) {
    write(
      root,
      'i18n/en.json',
      JSON.stringify(Object.fromEntries(Object.keys(ja).map((k) => [k, k])), null, 2) + '\n'
    );
  }
  return root;
}
