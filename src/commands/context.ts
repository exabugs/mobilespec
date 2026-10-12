// src/commands/context.ts
//
// 画面の文脈（A1）: 1 画面の実装・修正に必要なものを、3 層まとめて、解決済みで出す。
// 既定では、人向けの散文（summary / description / notes / links / mockup / status）は出さない（トークンを払わない）。
import yaml from 'js-yaml';

import { type Edge, expectedJa } from '../core/derive.js';
import { type Doc, type Project, asObj, isObj } from '../core/model.js';
import type { OpenApiIndex, Operation } from '../core/openapi.js';
import { operationsOf } from '../gen/index.js';

const PROSE_KEYS = new Set(['summary', 'description', 'notes', 'links', 'mockup', 'status']);

/** 人向けの散文を取り除く */
/** 値の中身がデータ（名前をキーに持つ）の位置。散文のキーと同名でも、取り除かない */
const DATA_KEYS = new Set(['set', 'args', 'params', 'props', 'constants', 'default', 'enum']);

export function stripProse(v: unknown, top = true): unknown {
  if (Array.isArray(v)) return v.map((x) => stripProse(x, false));
  if (isObj(v)) {
    return Object.fromEntries(
      Object.entries(v)
        // 最上位は散文のキーすべて。入れ子では、各項目の説明（文字列の description）だけ
        .filter(([k, x]) =>
          top ? !PROSE_KEYS.has(k) : !(k === 'description' && typeof x === 'string')
        )
        .map(([k, x]) => [k, DATA_KEYS.has(k) ? x : stripProse(x, false)])
    );
  }
  return v;
}

export type ContextModel = {
  screen: string;
  name: string;
  files: { l2?: string; l3?: string; l4?: string };
  l2?: unknown;
  l3?: unknown;
  l4?: unknown;
  incoming: Array<{ from: string; transition: string; params: string[] }>;
  outgoing: Array<{ to: string; transition: string; params: string[]; auto: boolean }>;
  operations: Array<{ operationId: string; params: string[]; response?: string; summary?: string }>;
  facts: Array<{ name: string; description?: string }>;
  ja: Record<string, string>;
};

function describeOp(op: Operation, withDocs: boolean) {
  const params = [
    ...op.params
      .filter((p) => p.in !== 'header' && p.in !== 'cookie')
      .map((p) => `${p.name}(${p.in}, ${p.type}${p.required ? ', 必須' : ''})`),
    ...(op.body?.props ?? []).map((b) => `${b.name}(body, ${b.type}${b.required ? ', 必須' : ''})`),
  ];
  return {
    operationId: op.operationId,
    params,
    ...(op.response !== undefined && { response: op.response }),
    ...(withDocs && op.summary ? { summary: op.summary } : {}),
  };
}

export function buildContext(
  project: Project,
  edges: Edge[],
  openapi: OpenApiIndex | undefined,
  id: string,
  options: { docs?: boolean } = {}
): ContextModel | undefined {
  const s = project.screens.get(id);
  if (!s?.l2) return undefined;
  const prune = (d: Doc | undefined): unknown =>
    d === undefined ? undefined : options.docs ? d : stripProse(d);

  // 参照している fact（この画面のファイルの文字列に現れるもの）
  const text = JSON.stringify([s.l2.data, s.l3?.data, s.l4?.data]);
  const facts = Object.entries(asObj(project.app?.data.facts))
    .filter(([name]) => new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`).test(text))
    .map(([name, v]) => ({
      name,
      ...(isObj(v) && typeof v.description === 'string' && { description: v.description }),
    }));

  const ja = Object.fromEntries(
    [...expectedJa(project).entries()].filter(([k]) => k.startsWith(`app.screen.${id}.`))
  );

  return {
    screen: id,
    name: String(s.l2.data.name ?? ''),
    files: { l2: s.l2.file, l3: s.l3?.file, l4: s.l4?.file },
    l2: prune(s.l2.data),
    l3: prune(s.l3?.data),
    l4: prune(s.l4?.data),
    incoming: edges
      .filter((e) => e.to === id)
      .map((e) => ({ from: e.from, transition: e.id, params: Object.keys(e.params) })),
    outgoing: edges
      .filter((e) => e.from === id)
      .map((e) => ({ to: e.to, transition: e.id, params: Object.keys(e.params), auto: e.auto })),
    operations: operationsOf(project, id).flatMap((opId) => {
      const op = openapi?.operations.get(opId);
      return op ? [describeOp(op, options.docs === true)] : [{ operationId: opId, params: [] }];
    }),
    facts,
    ja,
  };
}

const dump = (v: unknown): string => yaml.dump(v, { lineWidth: 120, noRefs: true }).trimEnd();

export function renderContext(model: ContextModel): string {
  const out: string[] = [];
  out.push(`# context: ${model.screen}（${model.name}）`);
  out.push('');
  out.push(
    '> 生成物です。1 画面の実装・修正に必要な情報を、3 層まとめて出しています。編集するのは、各レイヤーのファイルです。'
  );
  for (const [label, key, file] of [
    ['L2（画面間の接続）', 'l2', model.files.l2],
    ['L3（UI）', 'l3', model.files.l3],
    ['L4（状態・データ・振る舞い）', 'l4', model.files.l4],
  ] as const) {
    out.push('');
    out.push(`## ${label}${file ? ` — ${file}` : ''}`);
    const body = model[key];
    out.push('');
    out.push(body === undefined ? '（ファイルなし）' : '```yaml\n' + dump(body) + '\n```');
  }
  out.push('');
  out.push('## この画面への遷移');
  out.push('');
  out.push(
    model.incoming.length === 0
      ? '（なし）'
      : model.incoming
          .map(
            (e) =>
              `- ${e.from} の \`${e.transition}\`${e.params.length ? ` — params: ${e.params.join(', ')}` : ''}`
          )
          .join('\n')
  );
  out.push('');
  out.push('## この画面からの遷移');
  out.push('');
  out.push(
    model.outgoing.length === 0
      ? '（なし）'
      : model.outgoing
          .map(
            (e) =>
              `- \`${e.transition}\` → ${e.to}${e.params.length ? ` — params: ${e.params.join(', ')}` : ''}${e.auto ? '（auto）' : ''}`
          )
          .join('\n')
  );
  out.push('');
  out.push('## 使う API（入出力。URL・HTTP メソッドは仕様に書かない）');
  out.push('');
  out.push(
    model.operations.length === 0
      ? '（なし）'
      : model.operations
          .map(
            (o) =>
              `- \`${o.operationId}\` — 引数: ${o.params.length ? o.params.join(', ') : '（なし）'}${o.response ? ` → 応答: ${o.response}` : ''}${'summary' in o && o.summary ? ` — ${o.summary}` : ''}`
          )
          .join('\n')
  );
  out.push('');
  out.push('## 参照する facts');
  out.push('');
  out.push(
    model.facts.length === 0
      ? '（なし）'
      : model.facts
          .map((f) => `- \`${f.name}\`${f.description ? ` — ${f.description}` : ''}`)
          .join('\n')
  );
  out.push('');
  out.push('## ja の文言');
  out.push('');
  out.push(
    Object.keys(model.ja).length === 0
      ? '（なし）'
      : Object.entries(model.ja)
          .map(([k, v]) => `- \`${k}\`: ${v}`)
          .join('\n')
  );
  out.push('');
  return out.join('\n');
}
