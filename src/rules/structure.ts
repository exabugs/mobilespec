// src/rules/structure.ts — 構造（ID・名前・グループ・レイヤーの対応）の検証
import { type Diagnostic, notFound } from '../core/diagnostic.js';
import { type Project, asArray, asObj, isObj } from '../core/model.js';
import { l3Nodes } from '../core/walk.js';
import { factNames } from './scope.js';

/** 画面内の名前として使えない予約語（$params と衝突する） */
const RESERVED_NAMES = ['params'];

export function checkStructure(project: Project): Diagnostic[] {
  const out: Diagnostic[] = [];
  const groups = asArray(project.app?.data.groups).filter(
    (g): g is string => typeof g === 'string'
  );
  const facts = factNames(project);

  for (const [id, s] of project.screens) {
    // レイヤーの対応: L3 / L4 には、同じ ID の L2 が必要
    if (!s.l2) {
      for (const f of [s.l3, s.l4]) {
        if (f) {
          out.push({
            code: 'ORPHAN_LAYER_FILE',
            level: 'error',
            file: f.file,
            found: id,
            message: `画面 "${id}" の L2 がありません。画面の ID はファイル名で、L3 / L4 には同じ ID の L2（接続）が必要です`,
          });
        }
      }
      continue;
    }
    if (!s.l3) {
      out.push({
        code: 'MISSING_FILE',
        level: 'info',
        file: s.l2.file,
        message: `画面 "${id}" の L3（UI）がありません`,
      });
    }

    // グループ
    const group = s.l2.data.group;
    if (typeof group === 'string' && groups.length > 0 && !groups.includes(group)) {
      out.push(
        notFound(
          { code: 'UNKNOWN_GROUP', file: s.l2.file, pointer: '/group' },
          `グループ "${group}" が app.yaml の groups にありません`,
          group,
          groups
        )
      );
    }

    // 名前の衝突（参照の曖昧さをなくす）
    const owners = new Map<string, string[]>();
    const add = (name: unknown, from: string) => {
      if (typeof name !== 'string') return;
      owners.set(name, [...(owners.get(name) ?? []), from]);
    };
    for (const f of facts) add(f, 'facts（app.yaml）');
    for (const p of asArray(s.l2.data.params)) if (isObj(p)) add(p.name, 'params（L2）');
    const l4 = s.l4?.data;
    if (l4) {
      for (const st of asArray(l4.state)) if (isObj(st)) add(st.name, 'state（L4）');
      const data = asObj(l4.data);
      for (const k of Object.keys(asObj(data.queries))) add(k, 'data.queries（L4）');
      for (const k of Object.keys(asObj(data.mutations))) add(k, 'data.mutations（L4）');
      for (const k of Object.keys(asObj(l4.sources))) add(k, 'sources（L4）');
      for (const k of Object.keys(asObj(l4.conditions))) add(k, 'conditions（L4）');
    }
    for (const [name, from] of owners) {
      // params は $params.x で参照するので、他の種類と同名でもよい（params 同士の重複だけ見る）
      const refNames = from.filter((f) => f !== 'params（L2）');
      const isCollision =
        refNames.length > 1 || (from.length > 1 && from.every((f) => f === 'params（L2）'));
      if (isCollision) {
        out.push({
          code: 'NAME_COLLISION',
          level: 'error',
          file: (l4 ? s.l4 : s.l2)!.file,
          found: name,
          message: `名前 "${name}" が重複しています（${from.join(' と ')}）。参照が曖昧になるため、名前は画面内で一意にします`,
        });
      }
      if (RESERVED_NAMES.includes(name) && refNames.length > 0) {
        out.push({
          code: 'NAME_COLLISION',
          level: 'error',
          file: (l4 ? s.l4 : s.l2)!.file,
          found: name,
          message: `名前 "${name}" は予約語です（$params と衝突します）`,
        });
      }
    }

    // ID の衝突: L2 の遷移の ID 同士 / L2 の遷移と L4 のイベント（L3 の action が曖昧になる）
    const tIds = new Map<string, number>();
    asArray(s.l2.data.transitions).forEach((t, i) => {
      if (!isObj(t) || typeof t.id !== 'string') return;
      if (tIds.has(t.id)) {
        out.push({
          code: 'DUPLICATE_ID',
          level: 'error',
          file: s.l2!.file,
          pointer: `/transitions/${i}/id`,
          found: t.id,
          message: `遷移の ID "${t.id}" が重複しています（/transitions/${tIds.get(t.id)} と /transitions/${i}）`,
        });
      }
      tIds.set(t.id, i);
    });
    if (l4) {
      for (const key of Object.keys(asObj(l4.events))) {
        if (tIds.has(key)) {
          out.push({
            code: 'ID_COLLISION',
            level: 'error',
            file: s.l4!.file,
            pointer: `/events/${key}`,
            found: key,
            message: `イベント "${key}" が L2 の遷移と同じ ID です。L3 の action がどちらを指すのか曖昧になるため、同じ画面で同じ ID は使えません`,
          });
        }
      }
    }

    // 部品の ID の重複（i18n のキーが衝突する）
    if (s.l3) {
      const ids = new Map<string, string>();
      const note = (cid: unknown, pointer: string) => {
        if (typeof cid !== 'string') return;
        if (ids.has(cid)) {
          out.push({
            code: 'DUPLICATE_ID',
            level: 'error',
            file: s.l3!.file,
            pointer,
            found: cid,
            message: `部品の ID "${cid}" が重複しています（${ids.get(cid)} と ${pointer}）。i18n のキーが衝突します`,
          });
        }
        ids.set(cid, pointer);
      };
      for (const { node, pointer } of l3Nodes(s.l3.data)) {
        note(node.id, `${pointer}/id`);
        asArray(node.menu).forEach((m, i) => {
          if (isObj(m)) note(m.id, `${pointer}/menu/${i}/id`);
        });
      }
    }
  }
  return out;
}
