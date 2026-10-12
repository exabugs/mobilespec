// tests/validate.test.ts — 検証（設計書 §7）。有効なプロジェクトを 1 つ作り、一部だけ壊して負例にする
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { type DiagnosticCode, allByCode, errorsOf, findByCode } from '../src/core/diagnostic.js';
import { validate } from '../src/validate.js';
import { FILES, makeProject } from './helpers/okProject.js';

const schemaDir = path.resolve(process.cwd(), 'schema');
const run = (overrides: Record<string, string | null> = {}) => {
  const specsDir = makeProject(overrides);
  return validate({ specsDir, schemaDir });
};
const codes = (r: ReturnType<typeof run>): DiagnosticCode[] => errorsOf(r).map((d) => d.code);

describe('有効なプロジェクト', () => {
  it('error が 0 件', () => {
    const r = run();
    expect(errorsOf(r)).toEqual([]);
  });
});

describe('構造', () => {
  it('app.yaml が無い', () => {
    expect(codes(run({ 'app.yaml': null }))).toContain('APP_NOT_FOUND');
  });

  it('YAML の構文エラーは、行番号付きで報告する', () => {
    const d = findByCode(run({ 'L3.ui/home.ui.yaml': 'layout: [\n  - a\n' }), 'YAML_PARSE_ERROR');
    expect(d?.file).toBe('L3.ui/home.ui.yaml');
    expect(d?.message).toContain('行目');
  });

  it('L3 / L4 に対応する L2 が無い', () => {
    const d = findByCode(run({ 'L4.state/ghost.state.yaml': 'events: {}\n' }), 'ORPHAN_LAYER_FILE');
    expect(d?.file).toBe('L4.state/ghost.state.yaml');
  });

  it('画面 ID（ファイル名）が不正', () => {
    expect(codes(run({ 'L2.screenflows/Bad-Name.flow.yaml': 'name: x\ngroup: home\n' }))).toContain(
      'INVALID_FILE_ID'
    );
  });

  it('同じレイヤーに同じ ID のファイルが 2 つ（ディレクトリが違っても）', () => {
    const d = findByCode(
      run({ 'L2.screenflows/other/home.flow.yaml': 'name: ホーム\ngroup: home\n' }),
      'DUPLICATE_ID'
    );
    expect(d?.found).toBe('home');
  });

  it('L2 の group が app.yaml の groups に無い（候補つき）', () => {
    const d = findByCode(
      run({
        'L2.screenflows/home/home.flow.yaml': FILES['L2.screenflows/home/home.flow.yaml'].replace(
          'group: home',
          'group: hom'
        ),
      }),
      'UNKNOWN_GROUP'
    );
    expect(d?.suggest).toBe('home');
    expect(d?.expected).toEqual(['home', 'item']);
  });

  it('名前の衝突: state と condition が同名 / fact と同名 / 予約語 params', () => {
    const l4 = FILES['L4.state/item_detail.state.yaml'];
    const dup = run({
      'L4.state/item_detail.state.yaml': l4.replace('name: tab,', 'name: canJoin,'),
    });
    expect(allByCode(dup, 'NAME_COLLISION').length).toBeGreaterThan(0);
    const fact = run({
      'L4.state/item_detail.state.yaml': l4.replace('name: tab,', 'name: isSignedIn,'),
    });
    expect(codes(fact)).toContain('NAME_COLLISION');
    const reserved = run({
      'L4.state/item_detail.state.yaml': l4.replace('name: tab,', 'name: params,'),
    });
    expect(errorsOf(reserved).some((d) => d.message.includes('予約語'))).toBe(true);
  });

  it('同じ画面で、L2 の遷移とイベントが同じ ID（action が曖昧になる）', () => {
    const l4 = FILES['L4.state/item_detail.state.yaml'].replace('  join:\n', '  open_members:\n');
    expect(codes(run({ 'L4.state/item_detail.state.yaml': l4 }))).toContain('ID_COLLISION');
  });

  it('部品の ID の重複（i18n のキーが衝突する）', () => {
    const l3 = FILES['L3.ui/item_detail.ui.yaml'].replace('id: btn_join', 'id: btn_members');
    expect(codes(run({ 'L3.ui/item_detail.ui.yaml': l3 }))).toContain('DUPLICATE_ID');
  });
});

describe('レイヤーの純度（S4）: 置き場所の誤りは、正しい置き場所を案内する', () => {
  const misplaced = (overrides: Record<string, string>) =>
    allByCode(run(overrides), 'MISPLACED').map((d) => d.message);

  it('L4 に遷移の行き先を書くと、L2 に書くよう案内される', () => {
    const l4 = FILES['L4.state/item_detail.state.yaml'].replace(
      '      - go: after_join',
      '      - navigate: { to: item_members }'
    );
    const m = misplaced({ 'L4.state/item_detail.state.yaml': l4 });
    expect(m.join('\n')).toContain('L2 の transitions に書きます');
  });

  it('L2 に trigger / type / exit / guard / id を書くと、導くものだと案内される', () => {
    const l2 =
      FILES['L2.screenflows/item/item_detail.flow.yaml'] +
      'type: screen\nexit: true\nid: item_detail\n';
    const m = misplaced({ 'L2.screenflows/item/item_detail.flow.yaml': l2 }).join('\n');
    expect(m).toContain('画面の種類');
    expect(m).toContain('終端は書きません');
    expect(m).toContain('画面の ID はファイル名');
    const t = FILES['L2.screenflows/item/item_detail.flow.yaml'].replace(
      '  - id: back_home\n    target: home',
      '  - id: back_home\n    target: home\n    trigger: tap\n    guard: isSignedIn'
    );
    const m2 = misplaced({ 'L2.screenflows/item/item_detail.flow.yaml': t }).join('\n');
    expect(m2).toContain('起動のしかたは書きません');
    expect(m2).toContain('`when`（参照）');
  });

  it('旧体系の `screen:` の包みは不要だと案内される', () => {
    const m = misplaced({
      'L3.ui/home.ui.yaml': 'screen:\n  id: home\n  layout: { type: column }\n',
    });
    expect(m.join('\n')).toContain('`screen:` の包みは不要');
  });

  it('L2 / L3 に演算子を持つ式を書けない（ロジックは L4 の conditions に）', () => {
    const l2 = FILES['L2.screenflows/item/item_detail.flow.yaml'].replace(
      '  - id: back_home\n    target: home',
      '  - id: back_home\n    target: home\n    when: isSignedIn && noMembers'
    );
    const d = findByCode(
      run({ 'L2.screenflows/item/item_detail.flow.yaml': l2 }),
      'EXPRESSION_NOT_ALLOWED'
    );
    expect(d?.message).toContain('L4 の conditions');
    const l3 = FILES['L3.ui/item_detail.ui.yaml'].replace(
      'visibleWhen: noMembers',
      "visibleWhen: '!noMembers'"
    );
    expect(codes(run({ 'L3.ui/item_detail.ui.yaml': l3 }))).toContain('EXPRESSION_NOT_ALLOWED');
  });

  it('action を持つ部品に visibleWhen は書けない（可否は when が持つ）', () => {
    const l3 = FILES['L3.ui/item_detail.ui.yaml'].replace(
      'action: join, unavailable: hide',
      'action: join, visibleWhen: canJoin'
    );
    const d = findByCode(run({ 'L3.ui/item_detail.ui.yaml': l3 }), 'AVAILABILITY_IN_UI');
    expect(d?.message).toContain('unavailable');
  });
});

describe('L2', () => {
  it('entry が無い', () => {
    const l2 = FILES['L2.screenflows/home/home.flow.yaml'].replace('entry: true\n', '');
    expect(codes(run({ 'L2.screenflows/home/home.flow.yaml': l2 }))).toContain('NO_ENTRY');
  });

  it('到達できない画面は error。root: true にすれば起点になる', () => {
    const orphan = (extra: string) => `name: 孤立\ngroup: item\n${extra}transitions: []\n`;
    const files = (extra: string) => ({
      'L2.screenflows/item/orphan.flow.yaml': orphan(extra),
      'L3.ui/orphan.ui.yaml': 'layout: { type: column }\n',
    });
    expect(
      run(files('')).diagnostics.some(
        (d) => d.code === 'UNREACHABLE_SCREEN' && d.found === 'orphan'
      )
    ).toBe(true);
    expect(codes(run(files('root: true\n')))).not.toContain('UNREACHABLE_SCREEN');
  });

  it('遷移先が存在しない（候補つき）。external は予約語で存在しなくてよい', () => {
    const l2 = FILES['L2.screenflows/item/item_detail.flow.yaml'].replace(
      'target: item_members\n    params: { id: $params.id }\n  - id: after_join',
      'target: item_memberz\n    params: { id: $params.id }\n  - id: after_join'
    );
    const d = findByCode(
      run({ 'L2.screenflows/item/item_detail.flow.yaml': l2 }),
      'UNKNOWN_SCREEN'
    );
    expect(d?.suggest).toBe('item_members');
    expect(codes(run())).not.toContain('UNKNOWN_SCREEN');
  });

  it('渡す params が、行き先の契約と食い違う（必須の欠落・未知）', () => {
    const base = FILES['L2.screenflows/item/item_detail.flow.yaml'];
    const missing = base.replace(
      '    target: item_members\n    params: { id: $params.id }\n  - id: after_join',
      '    target: item_members\n  - id: after_join'
    );
    expect(
      findByCode(run({ 'L2.screenflows/item/item_detail.flow.yaml': missing }), 'PARAMS_MISMATCH')
        ?.found
    ).toBe('id');
    const unknown = base.replace(
      'params: { id: $params.id }\n  - id: after_join',
      'params: { id: $params.id, extra: 1 }\n  - id: after_join'
    );
    expect(
      findByCode(run({ 'L2.screenflows/item/item_detail.flow.yaml': unknown }), 'PARAMS_MISMATCH')
        ?.found
    ).toBe('extra');
  });

  it('$params に宣言の無いパラメータを参照', () => {
    const l2 = FILES['L2.screenflows/item/item_detail.flow.yaml'].replace(
      'params: { id: $params.id }\n  - id: after_join',
      'params: { id: $params.idd }\n  - id: after_join'
    );
    const d = findByCode(
      run({ 'L2.screenflows/item/item_detail.flow.yaml': l2 }),
      'UNKNOWN_REFERENCE'
    );
    expect(d?.suggest).toBe('$params.id');
  });

  it('auto の遷移: when も else も無い / else が複数 / else が auto でない', () => {
    const gate = (transitions: string) => ({
      'L2.screenflows/home/home.flow.yaml':
        FILES['L2.screenflows/home/home.flow.yaml'] + transitions,
    });
    const base = FILES['L2.screenflows/home/home.flow.yaml'];
    const noCond =
      base + '  - id: go_a\n    auto: true\n    target: item_members\n    params: { id: x }\n';
    expect(codes(run({ 'L2.screenflows/home/home.flow.yaml': noCond }))).toContain(
      'AUTO_WITHOUT_CONDITION'
    );
    const elses =
      base +
      '  - id: e1\n    auto: true\n    else: true\n    target: item_members\n    params: { id: x }\n' +
      '  - id: e2\n    auto: true\n    else: true\n    target: item_members\n    params: { id: x }\n';
    expect(codes(run({ 'L2.screenflows/home/home.flow.yaml': elses }))).toContain('MULTIPLE_ELSE');
    const elseTap =
      base + '  - id: e3\n    else: true\n    target: item_members\n    params: { id: x }\n';
    expect(codes(run({ 'L2.screenflows/home/home.flow.yaml': elseTap }))).toContain(
      'AUTO_WITHOUT_CONDITION'
    );
    void gate;
  });

  it('auto の遷移は、when の参照が成立すれば有効（UI の操作では起動しない）', () => {
    const base = FILES['L2.screenflows/home/home.flow.yaml'];
    const ok =
      base +
      '  - id: go_a\n    auto: true\n    when: isSignedIn\n    target: item_members\n    params: { id: x }\n';
    expect(errorsOf(run({ 'L2.screenflows/home/home.flow.yaml': ok }))).toEqual([]);
    const l3 = FILES['L3.ui/home.ui.yaml'].replace('action: open_item', 'action: go_a');
    const d = findByCode(
      run({ 'L2.screenflows/home/home.flow.yaml': ok, 'L3.ui/home.ui.yaml': l3 }),
      'UNKNOWN_ACTION'
    );
    expect(d?.message).toContain('auto の遷移');
  });
});

describe('L3', () => {
  it('action が、同じ画面の L2 の遷移にも L4 のイベントにも無い（候補つき）', () => {
    const l3 = FILES['L3.ui/item_detail.ui.yaml'].replace(
      'action: open_members',
      'action: open_memberz'
    );
    const d = findByCode(run({ 'L3.ui/item_detail.ui.yaml': l3 }), 'UNKNOWN_ACTION');
    expect(d?.suggest).toBe('open_members');
  });

  it('別の画面の遷移 ID は、この画面の action としては通らない（画面単位で検証する）', () => {
    const l3 = FILES['L3.ui/item_members.ui.yaml'].replace(
      '{ component: Text, id: txt_title, name: メンバー一覧 }',
      '{ component: Button, id: btn_x, name: X, action: open_members }'
    );
    expect(codes(run({ 'L3.ui/item_members.ui.yaml': l3 }))).toContain('UNKNOWN_ACTION');
  });

  it('メニュー項目の action も検査される', () => {
    const l3 = FILES['L3.ui/item_detail.ui.yaml'].replace(
      'action: open_share',
      'action: open_sharez'
    );
    expect(codes(run({ 'L3.ui/item_detail.ui.yaml': l3 }))).toContain('UNKNOWN_ACTION');
  });

  it('visibleWhen / repeatFrom の参照が存在しない名前', () => {
    const l3 = FILES['L3.ui/item_detail.ui.yaml'].replace(
      'visibleWhen: noMembers',
      'visibleWhen: noMemberz'
    );
    expect(findByCode(run({ 'L3.ui/item_detail.ui.yaml': l3 }), 'UNKNOWN_REFERENCE')?.suggest).toBe(
      'noMembers'
    );
    const rep = FILES['L3.ui/item_detail.ui.yaml'].replace(
      'visibleWhen: noMembers',
      'repeatFrom: item.data.members'
    );
    expect(errorsOf(run({ 'L3.ui/item_detail.ui.yaml': rep }))).toEqual([]);
  });
});

describe('L4', () => {
  const l4 = FILES['L4.state/item_detail.state.yaml'];
  const withL4 = (text: string) => run({ 'L4.state/item_detail.state.yaml': text });

  it('go が、L2 に無い / auto の遷移を指す', () => {
    const d = findByCode(
      withL4(l4.replace('go: after_join', 'go: after_joinn')),
      'UNKNOWN_TRANSITION'
    );
    expect(d?.suggest).toBe('after_join');
    expect(d?.message).toContain('L2');
  });

  it('mutate / refetch が、存在しない data のキーを指す', () => {
    expect(
      findByCode(withL4(l4.replace('mutate: join', 'mutate: joinn')), 'UNKNOWN_DATA_KEY')?.suggest
    ).toBe('join');
    expect(codes(withL4(l4.replace('refetch: [myStatus]', 'refetch: [nope]')))).toContain(
      'UNKNOWN_DATA_KEY'
    );
  });

  it('set の対象が state に無い / 型が合わない / enum に無い', () => {
    expect(codes(withL4(l4.replace('set: { tab: members }', 'set: { tabb: members }')))).toContain(
      'UNKNOWN_STATE'
    );
    expect(codes(withL4(l4.replace('set: { tab: members }', 'set: { tab: 5 }')))).toContain(
      'TYPE_MISMATCH'
    );
    expect(codes(withL4(l4.replace('set: { tab: members }', 'set: { tab: nowhere }')))).toContain(
      'TYPE_MISMATCH'
    );
  });

  it('式の構文エラー / 存在しない名前 / 条件の循環', () => {
    expect(
      codes(
        withL4(
          l4.replace('expr: item.data.members.length == 0', 'expr: item.data.members.length ==')
        )
      )
    ).toContain('EXPRESSION_SYNTAX');
    const unknown = findByCode(
      withL4(l4.replace('&& isSignedIn', '&& isSignedInn')),
      'UNKNOWN_REFERENCE'
    );
    expect(unknown?.suggest).toBe('isSignedIn');
    const cyc = l4
      .replace('expr: item.data.members.length == 0', 'expr: canJoin')
      .replace('&& isSignedIn', '&& isSignedIn && noMembers');
    expect(errorsOf(withL4(cyc)).some((d) => d.message.includes('循環'))).toBe(true);
  });

  it('クエリのメンバー: data / isPending / isError 以外は使えない', () => {
    expect(codes(withL4(l4.replace('!item.isPending', '!item.loading')))).toContain(
      'UNKNOWN_REFERENCE'
    );
  });

  it('型が不正 / default が型に合わない', () => {
    expect(codes(withL4(l4.replace('type: string, enum', 'type: text, enum')))).toContain(
      'INVALID_TYPE'
    );
    expect(codes(withL4(l4.replace('default: info', 'default: 3')))).toContain('TYPE_MISMATCH');
  });

  it('when が参照を超えた式 / when の参照が存在しない', () => {
    expect(codes(withL4(l4.replace('when: canJoin', 'when: canJoin && isSignedIn')))).toContain(
      'EXPRESSION_NOT_ALLOWED'
    );
    expect(codes(withL4(l4.replace('when: canJoin', 'when: canJoinn')))).toContain(
      'UNKNOWN_REFERENCE'
    );
  });
});

describe('OpenAPI との接続', () => {
  const l4 = FILES['L4.state/item_detail.state.yaml'];
  const withL4 = (text: string) => run({ 'L4.state/item_detail.state.yaml': text });

  it('operationId が OpenAPI に無い（候補つき）', () => {
    const d = findByCode(
      withL4(l4.replace('operationId: getItem', 'operationId: getItemm')),
      'UNKNOWN_OPERATION'
    );
    expect(d?.suggest).toBe('getItem');
  });

  it('args: 必須の欠落 / 未知の引数 / リテラルの型', () => {
    expect(
      findByCode(
        withL4(
          l4.replace('operationId: getItem, args: { id: $params.id }', 'operationId: getItem')
        ),
        'ARGS_MISMATCH'
      )?.found
    ).toBe('id');
    expect(
      findByCode(
        withL4(
          l4.replace(
            'operationId: getItem, args: { id: $params.id }',
            'operationId: getItem, args: { id: $params.id, extra: 1 }'
          )
        ),
        'ARGS_MISMATCH'
      )?.found
    ).toBe('extra');
    expect(
      codes(
        withL4(
          l4.replace(
            'operationId: getItem, args: { id: $params.id }',
            'operationId: getItem, args: { id: 5 }'
          )
        )
      )
    ).toContain('TYPE_MISMATCH');
  });

  it('args の $params の型が、OpenAPI の引数の型と合わない', () => {
    const l2 = FILES['L2.screenflows/item/item_detail.flow.yaml'].replace(
      'type: string, required: true, description: 項目の ID',
      'type: boolean, required: true, description: 項目の ID'
    );
    expect(codes(run({ 'L2.screenflows/item/item_detail.flow.yaml': l2 }))).toContain(
      'TYPE_MISMATCH'
    );
  });

  it('data を使うのに openapi が無い / OpenAPI が読めない', () => {
    const noOpenapi = FILES['app.yaml'].replace('openapi: ./openapi.yaml\n', '');
    expect(codes(run({ 'app.yaml': noOpenapi }))).toContain('OPENAPI_NOT_FOUND');
    expect(codes(run({ 'openapi.yaml': null }))).toContain('OPENAPI_NOT_FOUND');
  });
});

describe('i18n', () => {
  it('ja.json が仕様と食い違うと、1 件の error（update を促す）。他ロケールの欠落は info', () => {
    const r = run({
      'i18n/ja.json': '{"app.screen.home.title": "古い"}\n',
      'i18n/en.json': '{}\n',
    });
    const stale = allByCode(r, 'I18N_JA_STALE');
    expect(stale).toHaveLength(1);
    expect(stale[0].message).toContain('mobilespec update');
    expect(allByCode(r, 'I18N_UNTRANSLATED')[0].level).toBe('info');
  });

  it('ja.json が無い', () => {
    const specsDir = makeProject({ 'i18n/ja.json': '' });
    expect(
      validate({ specsDir, schemaDir }).diagnostics.some((d) => d.code === 'I18N_JA_STALE')
    ).toBe(true);
  });
});

describe('info（実装不能ではない）', () => {
  it('未使用の遷移・イベント・条件、終端、説明の未記入、HTTP の直書き', () => {
    const l2 =
      FILES['L2.screenflows/item/item_detail.flow.yaml'] + '  - id: lonely\n    target: home\n';
    const l4 = FILES['L4.state/item_detail.state.yaml'].replace(
      'description: 参加する',
      'description: GET /items/{id} を呼ぶ'
    );
    const r = run({
      'L2.screenflows/item/item_detail.flow.yaml': l2,
      'L4.state/item_detail.state.yaml': l4,
      'L2.screenflows/item/item_members.flow.yaml': FILES[
        'L2.screenflows/item/item_members.flow.yaml'
      ].replace(/summary:.*\n/, ''),
    });
    const infoCodes = r.diagnostics.filter((d) => d.level === 'info').map((d) => d.code);
    expect(infoCodes).toContain('UNUSED_TRANSITION');
    expect(infoCodes).toContain('DEAD_END_SCREEN');
    expect(infoCodes).toContain('HTTP_IN_TEXT');
    expect(infoCodes).toContain('MISSING_DESCRIPTION');
    expect(errorsOf(r)).toEqual([]);
  });
});

describe('--screen: 1 画面だけの診断', () => {
  it('その画面のファイルの診断だけを返す', () => {
    const specsDir = makeProject({
      'L3.ui/item_detail.ui.yaml': FILES['L3.ui/item_detail.ui.yaml'].replace(
        'action: open_members',
        'action: nope'
      ),
      'L3.ui/home.ui.yaml': FILES['L3.ui/home.ui.yaml'].replace(
        'action: open_item',
        'action: nope2'
      ),
    });
    const all = validate({ specsDir, schemaDir });
    const one = validate({ specsDir, schemaDir, screen: 'item_detail' });
    expect(errorsOf(all).length).toBeGreaterThan(errorsOf(one).length);
    expect(errorsOf(one).every((d) => d.file?.includes('item_detail'))).toBe(true);
  });
});
