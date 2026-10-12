// src/rules/l4.ts — L4（状態・データ・画面内の振る舞い）の検証
import { transitionsOf, usageOf } from '../core/derive.js';
import { type Diagnostic, notFound } from '../core/diagnostic.js';
import type { RefNode } from '../core/expr.js';
import { type Doc, type Project, asArray, asObj, isObj } from '../core/model.js';
import type { OpenApiIndex, Operation } from '../core/openapi.js';
import { literalMismatch, parseType, typeToString } from '../core/typelang.js';
import { RefChecker } from './refs.js';
import { scopeOf } from './scope.js';

type TypeCheckable = { type: unknown; enum?: unknown; default?: unknown };

const PRIM = ['string', 'number', 'integer', 'boolean'];

export function checkL4(
  project: Project,
  openapi: OpenApiIndex | undefined,
  usedBy: Map<string, Set<string>>
): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const [id, s] of project.screens) {
    if (!s.l4) continue;
    const file = s.l4.file;
    const l4 = s.l4.data;
    const scope = scopeOf(project, s);
    const used = usedBy.get(id) ?? new Set<string>();
    const checker = new RefChecker(scope, out, file, used);

    /* ---- 型（state / sources / params のように、型を持つ宣言） ---- */
    const declTypes = new Map<string, ReturnType<typeof parseType>>();
    const checkDecl = (pointer: string, name: string, decl: TypeCheckable) => {
      const t = parseType(decl.type);
      declTypes.set(name, t);
      if (!t.ok) {
        out.push({
          code: 'INVALID_TYPE',
          level: 'error',
          file,
          pointer: `${pointer}/type`,
          message: `"${name}" の型が不正です: ${t.message}`,
        });
        return;
      }
      if (t.type.k === 'unknown') {
        out.push({
          code: 'UNKNOWN_TYPE',
          level: 'info',
          file,
          pointer: `${pointer}/type`,
          message: `"${name}" の型が unknown（未定義）です`,
        });
      }
      const enumValues = Array.isArray(decl.enum) ? decl.enum : undefined;
      if (enumValues) {
        for (const ev of enumValues) {
          const m = literalMismatch(t.type, ev);
          if (m) {
            out.push({
              code: 'TYPE_MISMATCH',
              level: 'error',
              file,
              pointer: `${pointer}/enum`,
              message: `"${name}" の enum: ${m}`,
            });
          }
        }
      }
      if (decl.default !== undefined) {
        const m = literalMismatch(t.type, decl.default, enumValues);
        if (m) {
          out.push({
            code: 'TYPE_MISMATCH',
            level: 'error',
            file,
            pointer: `${pointer}/default`,
            message: `"${name}" の default: ${m}`,
          });
        }
      }
    };

    asArray(l4.state).forEach((st, i) => {
      if (isObj(st) && typeof st.name === 'string')
        checkDecl(`/state/${i}`, st.name, st as TypeCheckable);
    });
    for (const [name, src] of Object.entries(asObj(l4.sources))) {
      if (isObj(src)) checkDecl(`/sources/${name}`, name, src as TypeCheckable);
    }
    // L2 の params の型も、ここで検査する（型の言語は共通）
    asArray(s.l2?.data.params).forEach((p, i) => {
      if (!isObj(p) || typeof p.name !== 'string') return;
      const t = parseType(p.type);
      if (!t.ok) {
        out.push({
          code: 'INVALID_TYPE',
          level: 'error',
          file: s.l2!.file,
          pointer: `/params/${i}/type`,
          message: `パラメータ "${p.name}" の型が不正です: ${t.message}`,
        });
      } else if (t.type.k === 'unknown') {
        out.push({
          code: 'UNKNOWN_TYPE',
          level: 'info',
          file: s.l2!.file,
          pointer: `/params/${i}/type`,
          message: `パラメータ "${p.name}" の型が unknown（未定義）です`,
        });
      }
    });
    const stateTypeOf = (name: string) => {
      const r = declTypes.get(name);
      return r && r.ok ? r.type : undefined;
    };
    const stateEnumOf = (name: string): unknown[] | undefined => {
      const st = asArray(l4.state).find((x) => isObj(x) && x.name === name);
      return isObj(st) && Array.isArray(st.enum) ? st.enum : undefined;
    };

    /* ---- 条件（式） ---- */
    const condRefs = new Map<string, RefNode[]>();
    for (const [name, c] of Object.entries(asObj(l4.conditions))) {
      if (!isObj(c)) continue;
      const refs = checker.checkExpression(`/conditions/${name}/expr`, c.expr, 'expr');
      condRefs.set(name, refs);
    }
    // 条件の循環
    const visiting = new Set<string>();
    const done = new Set<string>();
    const reportedCycle = new Set<string>();
    const dfs = (name: string, path: string[]) => {
      if (done.has(name)) return;
      if (visiting.has(name)) {
        const cycle = [...path.slice(path.indexOf(name)), name];
        const key = [...cycle].sort().join('>');
        if (!reportedCycle.has(key)) {
          reportedCycle.add(key);
          out.push({
            code: 'UNKNOWN_REFERENCE',
            level: 'error',
            file,
            pointer: `/conditions/${name}/expr`,
            message: `条件が循環しています: ${cycle.join(' → ')}`,
          });
        }
        return;
      }
      visiting.add(name);
      for (const r of condRefs.get(name) ?? []) {
        if (!r.dollar && condRefs.has(r.root)) dfs(r.root, [...path, name]);
      }
      visiting.delete(name);
      done.add(name);
    };
    for (const name of condRefs.keys()) dfs(name, []);

    /* ---- データ（OpenAPI への接続） ---- */
    const data = asObj(l4.data);
    const checkOps = (kind: 'queries' | 'mutations') => {
      for (const [key, def] of Object.entries(asObj(data[kind]))) {
        if (!isObj(def)) continue;
        const base = `/data/${kind}/${key}`;
        if (def.args !== undefined) checker.checkValue(`${base}/args`, def.args, 'value');
        if (typeof def.operationId !== 'string' || !openapi) continue;
        const op = openapi.operations.get(def.operationId);
        if (!op) {
          out.push(
            notFound(
              { code: 'UNKNOWN_OPERATION', file, pointer: `${base}/operationId` },
              `operationId "${def.operationId}" が OpenAPI にありません`,
              def.operationId,
              [...openapi.operations.keys()]
            )
          );
          continue;
        }
        checkArgs(base, def, op, s.l2?.data);
      }
    };
    const checkArgs = (base: string, def: Doc, op: Operation, l2: Doc | undefined) => {
      const args = asObj(def.args);
      const known = new Map<string, { required: boolean; type: string }>();
      for (const p of op.params) {
        if (p.in === 'header' || p.in === 'cookie') continue;
        known.set(p.name, { required: p.required, type: p.type });
      }
      for (const b of op.body?.props ?? []) {
        known.set(b.name, { required: b.required && op.body?.required === true, type: b.type });
      }
      for (const [name, value] of Object.entries(args)) {
        const k = known.get(name);
        if (!k) {
          out.push(
            notFound(
              { code: 'ARGS_MISMATCH', file, pointer: `${base}/args/${name}` },
              `引数 "${name}" は operationId "${op.operationId}" にありません`,
              name,
              [...known.keys()]
            )
          );
          continue;
        }
        // リテラルの型 / params の型との一致
        if (PRIM.includes(k.type)) {
          const t = parseType(k.type);
          if (t.ok && typeof value === 'string' && !value.startsWith('$')) {
            const m = literalMismatch(t.type, value);
            if (m) {
              out.push({
                code: 'TYPE_MISMATCH',
                level: 'error',
                file,
                pointer: `${base}/args/${name}`,
                message: `引数 "${name}" は ${k.type} です: ${m}`,
              });
            }
          } else if (t.ok && typeof value !== 'string') {
            const m = literalMismatch(t.type, value);
            if (m) {
              out.push({
                code: 'TYPE_MISMATCH',
                level: 'error',
                file,
                pointer: `${base}/args/${name}`,
                message: `引数 "${name}" は ${k.type} です: ${m}`,
              });
            }
          }
          if (typeof value === 'string' && value.startsWith('$params.')) {
            const pname = value.slice('$params.'.length).split('.')[0];
            const decl = asArray(l2?.params).find((p) => isObj(p) && p.name === pname);
            const pt = isObj(decl) ? parseType(decl.type) : undefined;
            if (pt?.ok && pt.type.k === 'prim' && t.ok && t.type.k === 'prim') {
              const compatible =
                pt.type.name === t.type.name ||
                (pt.type.name === 'integer' && t.type.name === 'number') ||
                (pt.type.name === 'number' && t.type.name === 'integer');
              if (!compatible) {
                out.push({
                  code: 'TYPE_MISMATCH',
                  level: 'error',
                  file,
                  pointer: `${base}/args/${name}`,
                  message: `引数 "${name}" は ${k.type} ですが、$params.${pname} は ${typeToString(pt.type)} です`,
                });
              }
            }
          }
        }
      }
      const missing = [...known.entries()]
        .filter(([n, k]) => k.required && !(n in args))
        .map(([n]) => n);
      for (const m of missing) {
        out.push({
          code: 'ARGS_MISMATCH',
          level: 'error',
          file,
          pointer: `${base}/args`,
          found: m,
          expected: [...known.keys()].sort(),
          message: `operationId "${op.operationId}" の必須の引数 "${m}" が args にありません`,
        });
      }
    };
    checkOps('queries');
    checkOps('mutations');

    /* ---- イベント ---- */
    const transitions = transitionsOf(s.l2?.data ?? {});
    const goable = transitions.filter((t) => t.auto !== true).map((t) => String(t.id));
    const autoIds = new Set(transitions.filter((t) => t.auto === true).map((t) => String(t.id)));
    const queryKeys = Object.keys(asObj(data.queries));
    const mutationKeys = Object.keys(asObj(data.mutations));
    const stateNames = asArray(l4.state)
      .filter(isObj)
      .map((x) => String(x.name));

    const checkSteps = (pointer: string, steps: Doc[]) => {
      steps.forEach((st, i) => {
        const p = `${pointer}/${i}`;
        if (typeof st.mutate === 'string') {
          used.add(st.mutate);
          if (!mutationKeys.includes(st.mutate)) {
            out.push(
              notFound(
                { code: 'UNKNOWN_DATA_KEY', file, pointer: `${p}/mutate` },
                `mutate "${st.mutate}" が data.mutations にありません`,
                st.mutate,
                mutationKeys
              )
            );
          }
        }
        if (Array.isArray(st.refetch)) {
          st.refetch.forEach((q, k) => {
            if (typeof q !== 'string') return;
            used.add(q);
            if (!queryKeys.includes(q)) {
              out.push(
                notFound(
                  { code: 'UNKNOWN_DATA_KEY', file, pointer: `${p}/refetch/${k}` },
                  `refetch "${q}" が data.queries にありません`,
                  q,
                  queryKeys
                )
              );
            }
          });
        }
        if (isObj(st.set)) {
          for (const [field, value] of Object.entries(st.set)) {
            const fp = `${p}/set/${field}`;
            if (!stateNames.includes(field)) {
              out.push(
                notFound(
                  { code: 'UNKNOWN_STATE', file, pointer: fp },
                  `set の対象 "${field}" が state にありません`,
                  field,
                  stateNames
                )
              );
              continue;
            }
            used.add(field);
            checker.checkValue(fp, value, 'value');
            const t = stateTypeOf(field);
            if (t && !(typeof value === 'string' && value.startsWith('$'))) {
              const m = literalMismatch(t, value, stateEnumOf(field));
              if (m) {
                out.push({
                  code: 'TYPE_MISMATCH',
                  level: 'error',
                  file,
                  pointer: fp,
                  message: `set "${field}": ${m}`,
                });
              }
            }
          }
        }
        if (typeof st.go === 'string') {
          if (autoIds.has(st.go)) {
            out.push({
              code: 'UNKNOWN_TRANSITION',
              level: 'error',
              file,
              pointer: `${p}/go`,
              found: st.go,
              message: `go "${st.go}" は auto の遷移です。auto の遷移は条件で自動的に起こるため、go では起動できません`,
            });
          } else if (!goable.includes(st.go)) {
            out.push(
              notFound(
                { code: 'UNKNOWN_TRANSITION', file, pointer: `${p}/go` },
                `go "${st.go}" が、同じ画面の L2 の遷移にありません（遷移の行き先・params は L2 に書き、L4 からは go で参照します）`,
                st.go,
                goable
              )
            );
          }
        }
      });
    };
    for (const [key, ev] of Object.entries(asObj(l4.events))) {
      if (!isObj(ev)) continue;
      const base = `/events/${key}`;
      if (ev.when !== undefined) checker.checkReference(`${base}/when`, ev.when, 'when');
      checkSteps(`${base}/steps`, asArray(ev.steps).filter(isObj));
      checkSteps(`${base}/onError`, asArray(ev.onError).filter(isObj));
    }

    /* ---- 未使用の定義（info） ---- */
    const usage = usageOf(s);
    const unused = (kind: string, names: string[], pointerOf: (n: string) => string) => {
      for (const n of names) {
        if (!used.has(n)) {
          out.push({
            code: 'UNUSED_DEFINITION',
            level: 'info',
            file,
            pointer: pointerOf(n),
            found: n,
            message: `${kind} "${n}" はどこからも参照されていません`,
          });
        }
      }
    };
    unused('state', stateNames, (n) => `/state/${stateNames.indexOf(n)}`);
    unused('クエリ', queryKeys, (n) => `/data/queries/${n}`);
    unused('ミューテーション', mutationKeys, (n) => `/data/mutations/${n}`);
    unused('ソース', Object.keys(asObj(l4.sources)), (n) => `/sources/${n}`);
    unused('条件', Object.keys(asObj(l4.conditions)), (n) => `/conditions/${n}`);
    for (const [key, ev] of Object.entries(asObj(l4.events))) {
      const onEnter = isObj(ev) && ev.on === 'enter';
      if (!onEnter && !usage.actions.has(key)) {
        out.push({
          code: 'UNUSED_DEFINITION',
          level: 'info',
          file,
          pointer: `/events/${key}`,
          found: key,
          message: `イベント "${key}" を起動するものがありません（L3 の action から参照されていません。画面表示時なら on: enter）`,
        });
      }
    }
  }
  return out;
}
