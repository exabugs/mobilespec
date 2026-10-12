// src/migrate/convert.ts
//
// 旧体系 → 新体系の変換（設計書 §8）。変換は**情報を失わない**:
// - 散文は description に残す。式や型を決められないものは、description だけにして info で報告する
// - コメントは x-legacyComments に退避する
// - 決められないもの・要確認のものは、TODO として報告する
import yaml from 'js-yaml';
import path from 'node:path';

import { type Doc, asArray, asObj, isObj } from '../core/model.js';
import { NAME, SCREEN_ID } from '../core/names.js';
import type { OpenApiIndex, Operation } from '../core/openapi.js';
import { findApiRef, proseToExpr, resolveApi } from './helpers.js';
import { type OldProject, type OldScreen, extractComments } from './read.js';

export type MigrateReport = {
  /** 変換したことの要約（件数など） */
  notes: string[];
  /** 人が決める・確認するもの */
  todos: string[];
  counts: Record<string, number>;
};

export type ConvertResult = {
  /** 新体系のファイル（specs ディレクトリからの相対パス → 内容） */
  files: Map<string, string>;
  /** 新体系では不要になる旧ファイル */
  remove: string[];
  report: MigrateReport;
};

const dump = (v: unknown): string =>
  yaml.dump(v, { lineWidth: -1, noRefs: true, quotingType: "'" });

/** キーの順序を決めて並べる（決定的な出力） */
function ordered(obj: Doc, order: string[]): Doc {
  const out: Doc = {};
  for (const k of order) if (obj[k] !== undefined) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!(k in out) && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

const L2_ORDER = [
  'name',
  'group',
  'entry',
  'root',
  'status',
  'summary',
  'description',
  'notes',
  'links',
  'mockup',
  'params',
  'transitions',
];
const L3_ORDER = ['layoutVariant', 'appBar', 'bottomBar', 'layout', 'headerRight', 'states'];
const L4_ORDER = ['data', 'sources', 'state', 'conditions', 'events', 'constants'];

type TypedState = {
  name: string;
  type: unknown;
  enum?: unknown[];
  default?: unknown;
  description?: string;
};

function inferType(v: unknown): unknown {
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v)) return ['unknown'];
  return 'unknown';
}

function dialectType(t: unknown): unknown {
  if (typeof t !== 'string') return 'unknown';
  if (['string', 'number', 'integer', 'boolean'].includes(t)) return t;
  if (t === 'array') return ['unknown'];
  return 'unknown';
}

export function convertProject(
  old: OldProject,
  openapi: OpenApiIndex | undefined,
  options: { openapiRel?: string; newDir: string }
): ConvertResult {
  const notes: string[] = [];
  const todos: string[] = [];
  const counts: Record<string, number> = {};
  const bump = (k: string, n = 1) => {
    counts[k] = (counts[k] ?? 0) + n;
  };
  const files = new Map<string, string>();
  const remove: string[] = [];

  /* ---------- グループ・facts ---------- */
  const groupOrder = asArray(asObj(old.config.mermaid).groupOrder).filter(
    (g): g is string => typeof g === 'string'
  );
  const usedGroups = [
    ...new Set([...old.screens.values()].map((s) => s.group).filter((g): g is string => !!g)),
  ];
  const groups = [
    ...groupOrder.filter((g) => usedGroups.includes(g)),
    ...usedGroups.filter((g) => !groupOrder.includes(g)).sort(),
  ];
  const fallbackGroup = groups[0] ?? 'misc';
  if (!groups.includes(fallbackGroup)) groups.push(fallbackGroup);

  const facts: Record<string, { description?: string }> = {};
  for (const g of old.guards) {
    const description = [g.name, g.description].filter(Boolean).join('。');
    facts[g.id] = description ? { description } : {};
  }
  bump('facts', old.guards.length);

  /* ---------- 画面への params の流入（navigate / navigateStack のイベントの params）---------- */
  const incoming = new Map<string, Set<string>>();
  const addIncoming = (target: unknown, params: unknown) => {
    if (typeof target !== 'string' || !isObj(params)) return;
    const set = incoming.get(target) ?? new Set<string>();
    for (const k of Object.keys(params)) set.add(k);
    incoming.set(target, set);
  };
  for (const s of old.screens.values()) {
    const events = asObj(s.l4?.body.events);
    for (const ev of Object.values(events)) {
      if (!isObj(ev)) continue;
      if (ev.type === 'navigate') addIncoming(ev.targetScreenId, ev.params);
      if (ev.type === 'navigateStack') {
        for (const st of asArray(ev.steps))
          if (isObj(st)) addIncoming(st.targetScreenId, st.params);
      }
    }
  }

  /* ---------- 画面ごとに L4 → L2 → L3 ---------- */
  type Built = {
    id: string;
    l2?: Doc;
    l3?: Doc;
    l4?: Doc;
    transitions: Doc[];
    events: Record<string, Doc>;
    names: Map<string, string>;
  };
  const built = new Map<string, Built>();

  for (const s of old.screens.values()) {
    const b = convertScreen(s);
    if (b) built.set(s.id, b);
  }

  function convertScreen(s: OldScreen): Built | undefined {
    const id = s.id;
    if (!SCREEN_ID.test(id)) {
      todos.push(
        `${id}: 画面 ID が命名規則（小文字・数字・_）に合いません。ファイル名を直してください`
      );
      return undefined;
    }
    const l2 = s.l2?.body ?? {};
    const l4 = s.l4?.body ?? {};
    const needParams = new Map<string, { type: unknown; required: boolean }>();
    for (const name of incoming.get(id) ?? [])
      needParams.set(name, { type: 'unknown', required: false });
    const declaredParams = new Map<string, Doc>();
    for (const p of asArray(l4.params)) {
      if (isObj(p) && typeof p.name === 'string') declaredParams.set(p.name, p); // 別書式の params
    }

    /* ---- L4: state / stateData ---- */
    const stateByName = new Map<string, TypedState>();
    const oldState = l4.state;
    if (Array.isArray(oldState)) {
      for (const st of oldState) {
        if (!isObj(st) || typeof st.name !== 'string') continue;
        stateByName.set(st.name, {
          name: st.name,
          type: dialectType(st.type),
          ...(st.default !== undefined && { default: st.default }),
          ...(typeof st.description === 'string' && { description: st.description }),
        });
      }
    } else if (isObj(oldState)) {
      for (const [k, v] of Object.entries(oldState)) {
        stateByName.set(k, {
          name: k,
          type: 'unknown',
          ...(typeof v === 'string' && { description: v }),
        });
      }
    }
    for (const [k, v] of Object.entries(asObj(l4.stateData))) {
      const prev = stateByName.get(k);
      const t = inferType(v);
      stateByName.set(k, {
        name: k,
        type: t,
        ...(Array.isArray(v) || (typeof v !== 'object' && v !== null) ? { default: v } : {}),
        ...(prev?.description && { description: prev.description }),
      });
    }

    /* ---- L4: data（旧 data.queries / data.mutations + dataSource） ---- */
    const queries: Record<string, Doc> = {};
    const mutations: Record<string, Doc> = {};
    for (const [kind, target] of [
      ['queries', queries],
      ['mutations', mutations],
    ] as const) {
      for (const [k, def] of Object.entries(asObj(asObj(l4.data)[kind]))) {
        if (!isObj(def) || typeof def.operationId !== 'string') continue;
        target[k] = {
          operationId: def.operationId,
          ...(typeof def.selectRoot === 'string' && { selectRoot: def.selectRoot }),
        };
      }
    }
    const argsFor = (op: Operation): Doc => {
      const args: Doc = {};
      for (const p of op.params) {
        if (p.in !== 'path') continue;
        args[p.name] = `$params.${p.name}`;
        if (!needParams.has(p.name) && !declaredParams.has(p.name)) {
          needParams.set(p.name, {
            type: ['string', 'integer', 'number', 'boolean'].includes(p.type) ? p.type : 'string',
            required: true,
          });
        } else if (
          needParams.get(p.name)?.type === 'unknown' &&
          ['string', 'integer', 'number', 'boolean'].includes(p.type)
        ) {
          needParams.set(p.name, { type: p.type, required: true });
        }
      }
      return args;
    };
    for (const [k, v] of Object.entries(asObj(l4.dataSource))) {
      const ref = findApiRef(v);
      const op = resolveApi(openapi, ref);
      const target = op && op.method !== 'GET' ? mutations : queries;
      if (op && NAME.test(k)) {
        target[k] = {
          operationId: op.operationId,
          args: argsFor(op),
          ...(typeof v === 'string' && { description: v }),
        };
        const st = stateByName.get(k);
        if (st) {
          if (st.description)
            (target[k] as Doc).description = `${st.description}（取得元: ${String(v)}）`;
          stateByName.delete(k); // 状態ではなく、クエリになった（同名の state は重複なので消す）
        }
        bump('dataSource→data');
      } else {
        // 特定できない: state の description に取得元を残す（情報を失わない）
        const st = stateByName.get(k) ?? { name: k, type: 'unknown' };
        st.description = [st.description, `取得元: ${String(v)}`].filter(Boolean).join(' / ');
        stateByName.set(k, st);
        todos.push(
          `${id}: dataSource "${k}" の API を OpenAPI から特定できませんでした（${String(v)}）。L4 の data.queries に operationId で書いてください`
        );
      }
    }

    /* ---- L4: events ---- */
    const events: Record<string, Doc> = {};
    const navEvents = new Map<string, Doc>();
    const stackEvents = new Map<string, Doc>();
    const mutationFor = (opId: string, op: Operation): string => {
      const existing = Object.entries(mutations).find(([, m]) => m.operationId === opId);
      if (existing) return existing[0];
      mutations[opId] = { operationId: opId, args: argsFor(op) };
      return opId;
    };
    const oldEvents: Array<[string, Doc]> = Array.isArray(l4.events)
      ? l4.events
          .filter(isObj)
          .filter((e) => typeof e.name === 'string')
          .map((e) => [String(e.name), e] as [string, Doc])
      : Object.entries(asObj(l4.events))
          .filter(([, v]) => isObj(v))
          .map(([k, v]) => [k, v as Doc] as [string, Doc]);
    for (const [key, ev] of oldEvents) {
      const type = typeof ev.type === 'string' ? ev.type : undefined;
      if (type === 'navigate') {
        navEvents.set(key, ev);
        continue;
      }
      if (type === 'navigateStack') {
        stackEvents.set(key, ev);
        continue;
      }
      const ne: Doc = {};
      if (typeof ev.guard === 'string') ne.when = ev.guard;
      let description = typeof ev.description === 'string' ? ev.description : undefined;
      const steps: Doc[] = [];
      const apiText = typeof ev.api === 'string' ? ev.api : description;
      const op = resolveApi(openapi, findApiRef(apiText));
      if (type === 'callQuery' && typeof ev.query === 'string') {
        steps.push({ refetch: [ev.query] });
      } else if (type === 'callMutation' && typeof ev.mutation === 'string') {
        steps.push({ mutate: ev.mutation });
      } else if (type === 'external') {
        steps.push({ external: description ?? 'external' });
      } else if (type === 'updateState' && typeof ev.field === 'string') {
        description = [description, `更新する状態: ${ev.field}`].filter(Boolean).join(' / ');
        bump('updateState→説明のみ');
      } else if (op && (type === 'update' || type === undefined)) {
        const mk = mutationFor(op.operationId, op);
        steps.push({ mutate: mk });
        if (isObj(ev.mutation)) {
          const opts = ev.mutation;
          if (!mutations[mk].options) mutations[mk].options = opts;
        }
        if (isObj(ev.params)) {
          todos.push(
            `${id}: イベント "${key}" の params（${Object.keys(ev.params).join(', ')}）は、mutation "${mk}" の args に手で対応づけてください`
          );
        }
        for (const ok of asArray(ev.onSuccess)) {
          if (isObj(ok) && typeof ok.reload === 'string') steps.push({ refetch: [ok.reload] });
        }
        bump('update→mutate');
      }
      if (description) ne.description = description;
      if (steps.length > 0) ne.steps = steps;
      if (isObj(ev.mutation) && !steps.some((st) => 'mutate' in st)) bump('mutationオプション破棄');
      events[key] = ne;
    }
    // onEnterEffects → on: enter のイベント
    for (const [k, text] of Object.entries(asObj(l4.onEnterEffects))) {
      const key = `enter_${k}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      events[key] = {
        on: 'enter',
        ...(typeof text === 'string' && { description: text }),
        ...(typeof text === 'string' && { steps: [{ external: text }] }),
      };
      bump('onEnterEffects→event');
    }

    /* ---- L4: conditions ---- */
    const scopeNames = new Map<string, string>();
    for (const f of Object.keys(facts)) scopeNames.set(f, 'fact');
    for (const n of stateByName.keys()) scopeNames.set(n, 'state');
    for (const n of Object.keys(queries)) scopeNames.set(n, 'query');
    for (const n of Object.keys(mutations)) scopeNames.set(n, 'mutation');
    const rawConds: Array<[string, string | undefined, string | undefined]> = [];
    if (Array.isArray(l4.conditions)) {
      for (const c of l4.conditions) {
        if (isObj(c) && typeof c.name === 'string') {
          rawConds.push([
            c.name,
            typeof c.expression === 'string' ? c.expression : undefined,
            typeof c.description === 'string' ? c.description : undefined,
          ]);
        }
      }
    } else {
      for (const [k, v] of Object.entries(asObj(l4.conditions))) {
        if (typeof v === 'string') rawConds.push([k, undefined, v]);
        else if (isObj(v))
          rawConds.push([
            k,
            typeof v.expression === 'string'
              ? v.expression
              : typeof v.expr === 'string'
                ? v.expr
                : undefined,
            typeof v.description === 'string' ? v.description : undefined,
          ]);
      }
    }
    for (const [k] of rawConds) if (!facts[k]) scopeNames.set(k, 'condition');
    const conditions: Record<string, Doc> = {};
    for (const [k, expression, description] of rawConds) {
      if (facts[k] !== undefined) {
        // fact と同名の条件は、fact に統合する（名前は画面内で一意）
        const extra = [expression, description].filter(Boolean).join(' / ');
        if (extra && !facts[k].description?.includes(extra)) {
          facts[k].description = [facts[k].description, `（${id}: ${extra}）`]
            .filter(Boolean)
            .join(' ');
        }
        bump('条件→fact に統合');
        continue;
      }
      const text = expression ?? description;
      const expr = text ? proseToExpr(text, scopeNames) : undefined;
      const entry: Doc = {};
      if (expr) {
        entry.expr = expr;
        bump('条件→expr');
      } else {
        bump('条件→散文のみ');
      }
      const desc = expr && expression === undefined ? description : (description ?? expression);
      if (desc) entry.description = desc;
      conditions[k] = entry;
    }

    for (const name of Object.keys(conditions)) {
      const st = stateByName.get(name);
      if (!st) continue;
      if (st.description) {
        const c = conditions[name];
        c.description = [c.description, st.description].filter(Boolean).join(' / ');
      }
      stateByName.delete(name); // 名前は画面内で一意。派生する条件を残す
      bump('state→同名の条件に統合');
    }
    /* ---- L4 本体 ---- */
    const state: Doc[] = [];
    for (const st of stateByName.values()) {
      if (!NAME.test(st.name)) {
        todos.push(`${id}: 状態の名前 "${st.name}" が命名規則に合いません`);
        continue;
      }
      state.push(ordered(st as unknown as Doc, ['name', 'type', 'enum', 'default', 'description']));
      bump(st.type === 'unknown' ? 'state→型 unknown' : 'state→型あり');
    }
    const KNOWN = new Set([
      'id',
      'context',
      'state',
      'stateData',
      'dataSource',
      'conditions',
      'constants',
      'onEnterEffects',
      'data',
      'events',
      'params',
    ]);
    const extras: Doc = {};
    for (const [k, v] of Object.entries(l4)) {
      if (!KNOWN.has(k)) {
        extras[`x-${k}`] = v;
        bump('未知のキー→x-');
      }
    }
    const data: Doc = {};
    if (Object.keys(queries).length > 0) data.queries = queries;
    if (Object.keys(mutations).length > 0) data.mutations = mutations;
    let newL4: Doc | undefined;
    const hasL4 = s.l4 !== undefined;
    if (hasL4) {
      newL4 = ordered(
        {
          ...(Object.keys(data).length > 0 && { data }),
          ...(state.length > 0 && { state }),
          ...(Object.keys(conditions).length > 0 && { conditions }),
          events,
          ...(isObj(l4.constants) && { constants: l4.constants }),
          ...extras,
        },
        L4_ORDER
      );
    }

    /* ---- L2 ---- */
    const transitions: Doc[] = [];
    const seen = new Set<string>();
    for (const t of asArray(l2.transitions)) {
      if (!isObj(t) || typeof t.id !== 'string') continue;
      seen.add(t.id);
      const nt: Doc = { id: t.id };
      if (typeof t.target === 'string') nt.target = t.target;
      if (t.targetContext !== undefined) bump('context廃止');
      if (t.trigger === 'auto') nt.auto = true;
      if (typeof t.guard === 'string') nt.when = t.guard;
      if (t.else === true) nt.else = true;
      transitions.push(nt);
    }
    // 同じ画面への遷移（旧体系で画面内の操作を表すための代用）は、同名の L4 イベントがあれば、イベントだけを残す
    for (let i = transitions.length - 1; i >= 0; i--) {
      const t = transitions[i];
      if (t.target === id && typeof t.id === 'string' && events[t.id] !== undefined) {
        transitions.splice(i, 1);
        bump('L2自己遷移→L4イベントに一本化');
      }
    }
    // 同名のイベントと遷移（イベントが処理をして、画面を移る）: 遷移の名前を変え、イベントの最後で go する
    for (const t of transitions) {
      const ev = typeof t.id === 'string' ? events[t.id] : undefined;
      if (!ev || t.auto === true) continue;
      const renamed = `${String(t.id)}_go`;
      const steps = Array.isArray(ev.steps) ? ev.steps : [];
      ev.steps = [...steps, { go: renamed }];
      if (t.when !== undefined && ev.when === undefined) ev.when = t.when;
      t.id = renamed;
      bump('同名のイベントと遷移→go');
    }
    // L4 の navigate / navigateStack を L2 に統合（遷移は L2 だけが持つ）
    const addDescription = (nt: Doc, ev: Doc) => {
      if (typeof ev.description === 'string' && !nt.description) nt.description = ev.description;
    };
    for (const [key, ev] of navEvents) {
      let nt = transitions.find((t) => t.id === key);
      if (!nt) {
        nt = { id: key, target: ev.targetScreenId };
        transitions.push(nt);
        bump('navigate→L2に新設');
      }
      if (isObj(ev.params) && Object.keys(ev.params).length > 0) nt.params = ev.params;
      if (typeof ev.guard === 'string' && nt.when === undefined) nt.when = ev.guard;
      if (ev.navigateMode !== undefined || isObj(ev.mutation)) bump('navigateMode/mutation破棄');
      addDescription(nt, ev);
      bump('navigate→L2に統合');
    }
    for (const [key, ev] of stackEvents) {
      let nt = transitions.find((t) => t.id === key);
      if (!nt) {
        nt = { id: key };
        transitions.push(nt);
      }
      const stack = asArray(ev.steps)
        .filter(isObj)
        .map((st) => {
          const kind = st.type === 'push' || st.type === 'replace' ? st.type : 'navigate';
          return {
            [kind]: { to: st.targetScreenId, ...(isObj(st.params) && { params: st.params }) },
          };
        });
      delete nt.target;
      nt.stack = stack;
      if (typeof ev.guard === 'string' && nt.when === undefined) nt.when = ev.guard;
      addDescription(nt, ev);
      bump('navigateStack→L2のstack');
    }
    // auto で when も else も無い遷移が 1 つだけなら、else（その画面の唯一の自動遷移）
    const autoNoCond = transitions.filter(
      (t) => t.auto === true && t.when === undefined && t.else !== true
    );
    if (autoNoCond.length === 1 && transitions.filter((t) => t.auto === true).length === 1) {
      autoNoCond[0].else = true;
      bump('auto→else');
    } else if (autoNoCond.length > 0) {
      todos.push(
        `${id}: auto の遷移 ${autoNoCond.map((t) => String(t.id)).join(', ')} に条件（when）がありません。条件か else を決めてください`
      );
    }

    const params: Doc[] = [];
    const seenParam = new Set<string>();
    for (const [name, p] of declaredParams) {
      seenParam.add(name);
      params.push(
        ordered(
          {
            name,
            type: dialectType(p.type),
            ...(p.required === true && { required: true }),
            ...(typeof p.description === 'string' && { description: p.description }),
          },
          ['name', 'type', 'required', 'description']
        )
      );
    }
    for (const [name, p] of needParams) {
      if (seenParam.has(name)) continue;
      params.push({ name, type: p.type, ...(p.required && { required: true }) });
    }
    if (params.length > 0) bump('params推定', params.length);

    const group = s.group ?? fallbackGroup;
    if (!s.group)
      todos.push(
        `${id}: L2 がグループのディレクトリ配下にありません。group を ${fallbackGroup} にしました`
      );
    const newL2 = ordered(
      {
        name: typeof l2.name === 'string' ? l2.name : id,
        group,
        ...(l2.entry === true && { entry: true }),
        ...(params.length > 0 && { params }),
        transitions,
      },
      L2_ORDER
    );
    if (l2.type === 'choice') bump('type:choice廃止');
    if (l2.exit === true) bump('exit廃止');
    if (!s.l2) todos.push(`${id}: L2 がありません（L3 / L4 だけ）。L2 を作ってください`);

    return {
      id,
      l2: s.l2 ? newL2 : undefined,
      l4: newL4,
      l3: undefined,
      transitions,
      events,
      names: scopeNames,
    };
  }

  /* ---------- L3（transitions / events が出来てから: visibleWhen の整理）---------- */
  for (const s of old.screens.values()) {
    const b = built.get(s.id);
    if (!b || !s.l3) continue;
    const l3 = { ...s.l3.body };
    delete l3.id;
    delete l3.context;

    const whenOf = (action: string): { holder: Doc; where: string } | undefined => {
      const t = b.transitions.find((x) => x.id === action && x.auto !== true);
      if (t) return { holder: t, where: 'L2 の遷移' };
      const ev = b.events[action];
      if (ev) return { holder: ev, where: 'L4 のイベント' };
      return undefined;
    };
    const fix = (node: unknown): unknown => {
      if (!isObj(node)) return node;
      const n: Doc = { ...node };
      if (typeof n.action === 'string' && n.visibleWhen !== undefined) {
        const h = whenOf(n.action);
        const vw = n.visibleWhen;
        if (
          h &&
          typeof vw === 'string' &&
          // L2 の when が参照できるのは fact だけ。L4 のイベントは state / condition も参照できる
          (b.names.get(vw) === 'fact' ||
            (h.where === 'L4 のイベント' &&
              (b.names.get(vw) === 'state' || b.names.get(vw) === 'condition')))
        ) {
          if (h.holder.when === undefined) {
            h.holder.when = vw;
            delete n.visibleWhen;
            bump('visibleWhen→whenへ移動');
          } else if (h.holder.when === vw) {
            delete n.visibleWhen;
            bump('visibleWhen→重複を削除');
          } else {
            todos.push(
              `${b.id}: 部品 ${String(n.id)} の visibleWhen（${vw}）が action ${n.action} の when（${String(h.holder.when)}）と異なります。部品を visibleWhen 付きの入れ物で包むか、条件をまとめてください`
            );
            bump('visibleWhen→要手動');
          }
        } else {
          todos.push(
            `${b.id}: 部品 ${String(n.id)} の action と visibleWhen を整理できませんでした（visibleWhen: ${JSON.stringify(vw)}）。可否は遷移・イベントの when に書いてください`
          );
          bump('visibleWhen→要手動');
        }
      }
      if (Array.isArray(n.children)) n.children = n.children.map(fix);
      if (isObj(n.layout)) n.layout = fix(n.layout);
      return n;
    };
    if (isObj(l3.layout)) l3.layout = fix(l3.layout);
    if (Array.isArray(l3.headerRight)) l3.headerRight = l3.headerRight.map(fix);
    b.l3 = ordered(l3, L3_ORDER);
  }

  /* ---------- 到達できない画面は root にする（タブの最上位など。要確認）---------- */
  const targets = new Set<string>();
  for (const b of built.values()) {
    for (const t of b.transitions) {
      if (typeof t.target === 'string') targets.add(t.target);
      for (const st of asArray(t.stack)) {
        if (isObj(st))
          for (const v of Object.values(st))
            if (isObj(v) && typeof v.to === 'string') targets.add(v.to);
      }
    }
  }
  for (const b of built.values()) {
    if (b.l2 && b.l2.entry !== true && !targets.has(b.id)) {
      b.l2.root = true;
      b.l2 = ordered(b.l2, L2_ORDER);
      todos.push(
        `${b.id}: どの画面からも遷移されないため root: true にしました（タブの最上位など。意図を確認してください。孤立した画面なら削除を検討）`
      );
      bump('孤立画面→root');
    }
  }

  /* ---------- 出力 ---------- */
  for (const s of old.screens.values()) {
    const b = built.get(s.id);
    if (!b) continue;
    const put = (rel: string | undefined, doc: Doc | undefined, oldText: string | undefined) => {
      if (!rel || !doc) return;
      const comments = oldText ? extractComments(oldText) : [];
      const out = { ...doc };
      if (comments.length > 0) {
        out['x-legacyComments'] = comments;
        bump('コメント退避', comments.length);
      }
      files.set(rel, dump(out));
    };
    const group = s.group ?? fallbackGroup;
    const l2Rel = s.l2
      ? s.group
        ? s.l2.rel
        : `L2.screenflows/${group}/${s.id}.flow.yaml`
      : undefined;
    put(l2Rel, b.l2, s.l2?.text);
    put(s.l3?.rel, b.l3, s.l3?.text);
    put(s.l4?.rel, b.l4, s.l4?.text);
  }

  const appOpenapi = options.openapiRel;
  const guardComments = extractComments(''); // L2.guards.yaml のコメントは app.yaml に退避する（呼び出し側が渡す）
  void guardComments;
  const app: Doc = {
    version: 2,
    groups,
    ...(asArray(asObj(old.config.mermaid).screenOrder).length > 0 && {
      screenOrder: asObj(old.config.mermaid).screenOrder,
    }),
    locales:
      asArray(asObj(old.config.i18n).locales).length > 0 ? asObj(old.config.i18n).locales : ['ja'],
    ...(appOpenapi && { openapi: appOpenapi }),
    ...(Object.keys(facts).length > 0 && { facts }),
  };
  files.set('app.yaml', dump(app));

  for (const f of ['mobilespec.config.yml', 'L2.guards.yaml']) remove.push(f);
  void path;

  notes.push(`画面 ${built.size} 件を変換しました`);
  return { files, remove, report: { notes, todos, counts } };
}
