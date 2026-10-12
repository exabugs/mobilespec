// src/rules/l3.ts — L3（UI の構造）の検証
import { transitionsOf } from '../core/derive.js';
import { type Diagnostic, notFound } from '../core/diagnostic.js';
import { type Project, asArray, asObj, isObj } from '../core/model.js';
import { l3Nodes } from '../core/walk.js';
import { RefChecker } from './refs.js';
import { scopeOf } from './scope.js';

export function checkL3(project: Project, usedBy: Map<string, Set<string>>): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const [id, s] of project.screens) {
    if (!s.l3 || !s.l2) continue;
    const file = s.l3.file;
    const checker = new RefChecker(scopeOf(project, s), out, file, usedBy.get(id));

    // action が指せるもの: 同じ画面の L2 の遷移（auto 以外）、同じ画面の L4 のイベント
    const transitions = transitionsOf(s.l2.data).filter((t) => typeof t.id === 'string');
    const tap = transitions.filter((t) => t.auto !== true).map((t) => String(t.id));
    const auto = new Set(transitions.filter((t) => t.auto === true).map((t) => String(t.id)));
    const events = Object.keys(asObj(s.l4?.data.events));
    const candidates = [...tap, ...events];

    const checkAction = (pointer: string, action: unknown) => {
      if (typeof action !== 'string') return;
      if (candidates.includes(action)) return;
      if (auto.has(action)) {
        out.push({
          code: 'UNKNOWN_ACTION',
          level: 'error',
          file,
          pointer,
          found: action,
          expected: candidates.sort(),
          message: `action "${action}" は auto の遷移です。auto の遷移は条件で自動的に起こるため、UI の操作からは起動できません`,
        });
        return;
      }
      out.push(
        notFound(
          { code: 'UNKNOWN_ACTION', file, pointer },
          `action "${action}" が、同じ画面の L2 の遷移にも、L4 のイベントにもありません`,
          action,
          candidates
        )
      );
    };

    for (const { node, pointer } of l3Nodes(s.l3.data)) {
      if (node.action !== undefined) {
        checkAction(`${pointer}/action`, node.action);
        // 操作の可否は、遷移・イベントの when が持つ（D4）。L3 は表示のしかた（unavailable）だけ
        if (node.visibleWhen !== undefined) {
          out.push({
            code: 'AVAILABILITY_IN_UI',
            level: 'error',
            file,
            pointer: `${pointer}/visibleWhen`,
            found: String(node.visibleWhen),
            message: `action を持つ部品に visibleWhen は書けません。操作の可否は、遷移（L2）またはイベント（L4）の when が持ちます。使えないときの表示のしかたは unavailable: hide | disable で指定してください（別の表示条件が必要なら、部品を visibleWhen 付きの入れ物で包みます）`,
          });
        }
      }
      if (node.visibleWhen !== undefined && node.action === undefined) {
        checker.checkReference(`${pointer}/visibleWhen`, node.visibleWhen, 'visibleWhen');
      }
      if (node.repeatFrom !== undefined) {
        checker.checkReference(`${pointer}/repeatFrom`, node.repeatFrom, 'repeatFrom');
      }
      if (node.props !== undefined) checker.checkValue(`${pointer}/props`, node.props, 'value');
      asArray(node.menu).forEach((m, i) => {
        if (isObj(m) && m.action !== undefined)
          checkAction(`${pointer}/menu/${i}/action`, m.action);
      });
    }
  }
  return out;
}
