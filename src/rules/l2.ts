// src/rules/l2.ts — L2（画面間の接続）の検証
import { type Edge, reachableScreens, transitionsOf, usageOf } from '../core/derive.js';
import { type Diagnostic, notFound } from '../core/diagnostic.js';
import { type Project, asArray, asObj, isObj } from '../core/model.js';
import { EXTERNAL_TARGET } from '../core/names.js';
import { RefChecker } from './refs.js';
import { scopeOf } from './scope.js';

type ParamDecl = { name: string; required: boolean };

function paramDecls(l2: Record<string, unknown> | undefined): ParamDecl[] {
  return asArray(l2?.params)
    .filter(isObj)
    .filter((p) => typeof p.name === 'string')
    .map((p) => ({ name: String(p.name), required: p.required === true }));
}

export function checkL2(
  project: Project,
  edges: Edge[],
  usedBy: Map<string, Set<string>>
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const screenIds = [...project.screens.keys()].filter((id) => project.screens.get(id)?.l2);

  // entry
  const hasEntry = screenIds.some((id) => project.screens.get(id)!.l2!.data.entry === true);
  if (screenIds.length > 0 && !hasEntry) {
    out.push({
      code: 'NO_ENTRY',
      level: 'error',
      message:
        'entry: true の画面がありません（起点が無いため到達可能性を定義できず実装不能）。起動直後の画面の L2 に entry: true を書いてください',
    });
  }

  // 到達可能性（entry / root から）
  if (hasEntry) {
    const reached = reachableScreens(project, edges);
    for (const id of screenIds) {
      if (!reached.has(id)) {
        out.push({
          code: 'UNREACHABLE_SCREEN',
          level: 'error',
          file: project.screens.get(id)!.l2!.file,
          found: id,
          message: `画面 "${id}" は entry / root から到達できません（実装不能）。どこかの画面から遷移を書くか、タブの最上位などなら root: true を書いてください`,
        });
      }
    }
  }

  for (const id of screenIds) {
    const s = project.screens.get(id)!;
    const l2 = s.l2!;
    const checker = new RefChecker(scopeOf(project, s), out, l2.file, usedBy.get(id));

    // 遷移ごと
    const usage = usageOf(s);
    let elseCount = 0;
    transitionsOf(l2.data).forEach((t, i) => {
      const base = `/transitions/${i}`;
      const auto = t.auto === true;

      // when（参照だけ）
      if (t.when !== undefined) checker.checkReference(`${base}/when`, t.when, 'when');

      // auto の規則
      if (t.else === true) {
        elseCount++;
        if (!auto) {
          out.push({
            code: 'AUTO_WITHOUT_CONDITION',
            level: 'error',
            file: l2.file,
            pointer: `${base}/else`,
            message: `else: true は auto: true の遷移にだけ書けます（遷移 "${String(t.id)}"）`,
          });
        }
      }
      if (auto && t.when === undefined && t.else !== true) {
        out.push({
          code: 'AUTO_WITHOUT_CONDITION',
          level: 'error',
          file: l2.file,
          pointer: base,
          message: `auto の遷移 "${String(t.id)}" には when（条件の参照）か else: true が必要です。条件が無いと、いつ遷移するのか決まりません`,
        });
      }

      // 行き先（target または stack の各ステップ）
      const hops: Array<{ pointer: string; to: unknown; params: unknown }> = [];
      if (typeof t.target === 'string')
        hops.push({ pointer: `${base}/target`, to: t.target, params: t.params });
      else if (Array.isArray(t.stack)) {
        t.stack.forEach((st, k) => {
          if (!isObj(st)) return;
          const kind = (['navigate', 'push', 'replace'] as const).find((x) => isObj(st[x]));
          if (!kind) return;
          const body = asObj(st[kind]);
          hops.push({ pointer: `${base}/stack/${k}/${kind}/to`, to: body.to, params: body.params });
        });
      }

      for (const hop of hops) {
        const to = typeof hop.to === 'string' ? hop.to : '';
        const paramsPointer = hop.pointer.replace(/\/(target|to)$/, '/params');
        if (hop.params !== undefined) checker.checkValue(paramsPointer, hop.params, 'value');
        if (to === EXTERNAL_TARGET) continue;
        const target = project.screens.get(to);
        if (!target?.l2) {
          out.push(
            notFound(
              { code: 'UNKNOWN_SCREEN', file: l2.file, pointer: hop.pointer },
              `遷移先の画面 "${to}" が存在しません（遷移 "${String(t.id)}"）`,
              to,
              [...screenIds, EXTERNAL_TARGET]
            )
          );
          continue;
        }
        // 渡す params と、行き先の params の契約
        const decls = paramDecls(target.l2.data);
        const given = new Set(Object.keys(asObj(hop.params)));
        for (const g of given) {
          if (!decls.some((d) => d.name === g)) {
            out.push(
              notFound(
                { code: 'PARAMS_MISMATCH', file: l2.file, pointer: `${paramsPointer}/${g}` },
                `遷移先 "${to}" の params に "${g}" はありません（遷移 "${String(t.id)}"）`,
                g,
                decls.map((d) => d.name)
              )
            );
          }
        }
        for (const d of decls) {
          if (d.required && !given.has(d.name)) {
            out.push({
              code: 'PARAMS_MISMATCH',
              level: 'error',
              file: l2.file,
              pointer: paramsPointer,
              found: d.name,
              expected: decls.filter((x) => x.required).map((x) => x.name),
              message: `遷移先 "${to}" の必須の params "${d.name}" が渡されていません（遷移 "${String(t.id)}"）`,
            });
          }
        }
      }

      // 起動する参照元が無い遷移（auto 以外）
      if (!auto && typeof t.id === 'string' && !usage.actions.has(t.id) && !usage.gos.has(t.id)) {
        out.push({
          code: 'UNUSED_TRANSITION',
          level: 'info',
          file: l2.file,
          pointer: base,
          found: t.id,
          message: `遷移 "${t.id}" を起動するものがありません（L3 の action からも、L4 の go からも参照されていません）`,
        });
      }
    });
    if (elseCount > 1) {
      out.push({
        code: 'MULTIPLE_ELSE',
        level: 'error',
        file: l2.file,
        message: `画面 "${id}" に else: true の遷移が ${elseCount} 個あります（最大 1 つ）`,
      });
    }

    // 終端（遷移が無い画面）
    if (transitionsOf(l2.data).length === 0) {
      out.push({
        code: 'DEAD_END_SCREEN',
        level: 'info',
        file: l2.file,
        message: `画面 "${id}" には遷移がありません（終端）`,
      });
    }
  }
  return out;
}
