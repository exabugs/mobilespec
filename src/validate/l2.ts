// src/validate/l2.ts
import type { Diagnostic } from '../types/diagnostic.js';
import {
  ambiguousTarget,
  duplicateScreenId,
  invalidTransitionTarget,
  targetContextNotFound,
} from './diagnostics.js';
import type { YamlFile } from './io.js';
import { displayId, screenKey } from './keys.js';
import type { MobileSpecConfig, Screen, Transition } from './types.js';

/* ================================
 * Collect Screens and Transitions
 * ================================ */

export function collectScreensAndTransitions(
  files: YamlFile[],
  config: MobileSpecConfig
): {
  screens: Map<string, Screen>;
  transitions: Transition[];
  errors: Diagnostic[];
} {
  const screens = new Map<string, Screen>();
  const variantsById = new Map<string, Screen[]>();
  const errors: Diagnostic[] = [];

  // グループの順序マップを作成
  const groupOrderMap = new Map<string, number>();
  config.mermaid.groupOrder.forEach((group, index) => {
    groupOrderMap.set(group, index + 1);
  });

  // 画面IDの順序マップを作成
  const screenOrderMap = new Map<string, number>();
  (config.mermaid.screenOrder || []).forEach((screenId, index) => {
    screenOrderMap.set(screenId, index + 1);
  });

  // screen を全部集める
  for (const file of files) {
    const doc = file.data;
    const screen = doc.screen as Record<string, unknown> | undefined;
    if (!screen) continue;

    // 画面の順序を設定（screenOrderMapに定義があればそれを使用、なければ99）
    const screenOrder = screenOrderMap.get(screen.id as string) || 99;

    const s: Screen = {
      id: screen.id as string,
      name: screen.name as string,
      type:
        screen.type === 'choice' || screen.type === 'screen'
          ? (screen.type as 'screen' | 'choice')
          : 'screen',
      group: file.group, // ディレクトリ構造から決定
      order: screenOrder,
      entry: screen.entry === true,
      exit: screen.exit === true,
      context: typeof screen.context === 'string' ? screen.context : undefined,
    };

    // groupOrderMap を使うなら、ここで order を group の優先度に寄せる等も可能だが、
    // 現状は未使用なので保持だけ（将来拡張向け）
    void groupOrderMap;

    const key = screenKey(s.id, s.context);
    if (screens.has(key)) {
      errors.push(duplicateScreenId(key, s.id, s.context));
      continue;
    }

    screens.set(key, s);

    if (!variantsById.has(s.id)) variantsById.set(s.id, []);
    variantsById.get(s.id)!.push(s);
  }

  // transitions を集める
  const transitions: Transition[] = [];

  for (const file of files) {
    const doc = file.data;
    const screen = doc.screen as Record<string, unknown> | undefined;
    if (!screen) continue;

    const fromContext = typeof screen.context === 'string' ? screen.context : undefined;
    const fromKey = screenKey(screen.id as string, fromContext);

    for (const t of (screen.transitions as Array<Record<string, unknown>> | undefined) ?? []) {
      const targetId: string = t.target as string;
      const targetContext: string | undefined =
        typeof t.targetContext === 'string' ? t.targetContext : undefined;
      const transitionId = t.id as string;

      const candidates = variantsById.get(targetId) ?? [];
      if (candidates.length === 0) {
        errors.push(invalidTransitionTarget(fromKey, targetId, transitionId));
        continue;
      }

      let toKey: string;

      if (targetContext) {
        const hit = candidates.find((s) => s.context === targetContext);
        if (!hit) {
          errors.push(targetContextNotFound(targetId, targetContext, fromKey, transitionId));
          continue;
        }
        toKey = screenKey(hit.id, hit.context);
      } else if (candidates.length === 1) {
        const only = candidates[0];
        toKey = screenKey(only.id, only.context);
      } else {
        const opts = candidates.map((s) => displayId(s.id, s.context)).join(', ');
        errors.push(ambiguousTarget(targetId, opts, fromKey, transitionId));
        continue;
      }

      transitions.push({
        fromKey,
        toKey,
        label: transitionId,
        trigger: (t.trigger as 'tap' | 'auto') ?? undefined,
        guard: typeof t.guard === 'string' ? t.guard : undefined,
        else: t.else === true,
        self: fromKey === toKey,
      });
    }
  }

  return { screens, transitions, errors };
}

/* ================================
 * Validate Transitions
 *
 * Policy:
 * - entry は 0 件なら error（実装不能）
 * - entry は複数でも OK（info で状態表示）
 * - entry から到達不能な screen は error（実装不能）
 * - outgoing が無い（exit 以外）は info（状態）
 * ================================ */

export function validateTransitions(
  screens: Map<string, Screen>,
  transitions: Transition[],
  guardIds: Set<string>
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // choice node constraints (guard/else)
  // - choice から出る遷移は guard または else のいずれかを必須
  // - else:true は最大 1 本
  // - choice の outgoing は trigger:auto を推奨（tap は warning）
  const outgoingByFromKey = new Map<string, Transition[]>();
  for (const t of transitions) {
    const arr = outgoingByFromKey.get(t.fromKey) ?? [];
    arr.push(t);
    outgoingByFromKey.set(t.fromKey, arr);
  }

  for (const [key, s] of screens.entries()) {
    if (s.type !== 'choice') continue;
    const outs = outgoingByFromKey.get(key) ?? [];
    if (outs.length === 0) continue;

    const elseCount = outs.filter((t) => t.else === true).length;
    if (elseCount >= 2) {
      diagnostics.push({
        code: 'L2_INVALID',
        level: 'error',
        message: `choice screen の else:true 遷移が複数あります（最大1本）: ${displayId(
          s.id,
          s.context
        )}`,
        meta: { screenKey: key, elseCount },
      });
    }

    const missingGuards = outs.filter(
      (t) => !(typeof t.guard === 'string' && t.guard.trim() !== '') && t.else !== true
    );
    if (missingGuards.length) {
      diagnostics.push({
        code: 'L2_INVALID',
        level: 'error',
        message: `choice screen の遷移には guard または else:true が必要です: ${displayId(
          s.id,
          s.context
        )}`,
        meta: {
          screenKey: key,
          count: missingGuards.length,
          labels: missingGuards.map((t) => t.label),
        },
      });
    }

    const tapOuts = outs.filter((t) => t.trigger === 'tap');
    if (tapOuts.length) {
      diagnostics.push({
        code: 'L2_INVALID',
        level: 'error',
        message: `choice screen の遷移 trigger が tap になっています（推奨: auto）: ${displayId(
          s.id,
          s.context
        )}`,
        meta: { screenKey: key, count: tapOuts.length, labels: tapOuts.map((t) => t.label) },
      });
    }
  }

  // guard SSOT validation
  // - if a transition has guard, it must exist in L2.guards.yaml
  // - unused guard definitions are reported as info
  const usedGuards = new Set<string>();
  const unknownGuards: { fromKey: string; label?: string; guard: string }[] = [];

  for (const t of transitions) {
    if (typeof t.guard !== 'string' || !t.guard.trim()) continue;
    const g = t.guard.trim();
    usedGuards.add(g);
    if (!guardIds.has(g)) {
      unknownGuards.push({ fromKey: t.fromKey, label: t.label, guard: g });
    }
  }

  if (unknownGuards.length) {
    const samples = unknownGuards
      .slice(0, 10)
      .map((x) => `${x.guard} @ ${x.fromKey}${x.label ? `/${x.label}` : ''}`)
      .join(', ');
    diagnostics.push({
      code: 'L2_INVALID',
      level: 'error',
      message: `未定義の guard が L2 に指定されています（L2.guards.yaml に定義してください）: ${samples}${
        unknownGuards.length > 10 ? ` ... +${unknownGuards.length - 10}` : ''
      }`,
      meta: { count: unknownGuards.length },
    });
  }

  const unused = [...guardIds].filter((g) => !usedGuards.has(g));
  if (unused.length) {
    diagnostics.push({
      code: 'L2_INVALID',
      level: 'info',
      message: `L2.guards.yaml の guard が未使用です: ${unused.slice(0, 20).join(', ')}${
        unused.length > 20 ? ` ... +${unused.length - 20}` : ''
      }`,
      meta: { count: unused.length },
    });
  }

  const entryKeys: string[] = [];
  for (const [key, s] of screens.entries()) {
    if (s.entry) entryKeys.push(key);
  }

  // entry が無い = 実装不能
  if (entryKeys.length === 0) {
    diagnostics.push({
      code: 'L2_INVALID',
      level: 'error',
      message:
        'entry: true の screen が存在しません（起点が無いため到達可能性を定義できず実装不能）',
    });
    // entry が無い場合でも、他の状態（outgoing 等）は参考になりうるので続行する
  } else {
    // entry が複数 = 許容（状態）
    if (entryKeys.length >= 2) {
      const entries = entryKeys
        .map((k) => {
          const s = screens.get(k);
          return s ? displayId(s.id, s.context) : k;
        })
        .join(', ');
      diagnostics.push({
        code: 'L2_INVALID',
        level: 'info',
        message: `entry screen が複数あります（許容）: ${entries}`,
        meta: { entryKeys },
      });
    } else {
      const only = screens.get(entryKeys[0]);
      diagnostics.push({
        code: 'L2_INVALID',
        level: 'info',
        message: `entry screen: ${only ? displayId(only.id, only.context) : entryKeys[0]}`,
        meta: { entryKeys },
      });
    }
  }

  // グラフ探索（entry から到達可能か）
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const k of entryKeys) {
    if (!reachable.has(k)) {
      reachable.add(k);
      queue.push(k);
    }
  }

  // adjacency
  const outgoingByFrom = new Map<string, string[]>();
  for (const t of transitions) {
    const arr = outgoingByFrom.get(t.fromKey) ?? [];
    arr.push(t.toKey);
    outgoingByFrom.set(t.fromKey, arr);
  }

  while (queue.length) {
    const cur = queue.shift()!;
    const nexts = outgoingByFrom.get(cur) ?? [];
    for (const n of nexts) {
      if (!reachable.has(n)) {
        reachable.add(n);
        queue.push(n);
      }
    }
  }

  // 到達不能 = 実装不能
  const unreachable: { key: string; label: string }[] = [];
  for (const [key, s] of screens.entries()) {
    if (!reachable.has(key)) {
      unreachable.push({ key, label: displayId(s.id, s.context) });
    }
  }

  if (unreachable.length) {
    const list = unreachable
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((u) => `  - ${u.label} (${u.key})`)
      .join('\n');

    diagnostics.push({
      code: 'L2_INVALID',
      level: 'error',
      message: `entry から到達不能な screen があります（実装不能）:\n${list}`,
      meta: { count: unreachable.length, keys: unreachable.map((u) => u.key) },
    });
  }

  // exit でないのに outgoing が無い = 状態（info）
  const screensWithOutgoing = new Set<string>();
  for (const t of transitions) screensWithOutgoing.add(t.fromKey);

  const noOutgoing: { key: string; label: string }[] = [];
  for (const [key, s] of screens.entries()) {
    if (!s.exit && !screensWithOutgoing.has(key)) {
      noOutgoing.push({ key, label: displayId(s.id, s.context) });
    }
  }

  if (noOutgoing.length) {
    const list = noOutgoing
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((u) => `  - ${u.label} (${u.key})`)
      .join('\n');

    diagnostics.push({
      code: 'L2_INVALID_TRANSITION_TO',
      level: 'info',
      message: `exit ではないのに遷移先（outgoing）が無い screen:\n${list}`,
      meta: { count: noOutgoing.length, keys: noOutgoing.map((u) => u.key) },
    });
  }

  return diagnostics;
}
