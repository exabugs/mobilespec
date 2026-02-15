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
        self: fromKey === toKey,
      });
    }
  }

  return { screens, transitions, errors };
}

/* ================================
 * Validate Transitions
 * ================================ */

export function validateTransitions(
  screens: Map<string, Screen>,
  transitions: Transition[]
): Diagnostic[] {
  const warnings: Diagnostic[] = [];
  const screensWithIncoming = new Set<string>();
  const screensWithOutgoing = new Set<string>();

  // 遷移の存在チェック
  for (const t of transitions) {
    screensWithOutgoing.add(t.fromKey);
    screensWithIncoming.add(t.toKey);
  }

  // 遷移元がない画面（entry以外）
  for (const [key, screen] of screens.entries()) {
    if (!screen.entry && !screensWithIncoming.has(key)) {
      warnings.push({
        code: 'L2_INVALID_TRANSITION_FROM',
        level: 'warning',
        message: `遷移元がありません: ${displayId(screen.id, screen.context)} (${key})`,
        meta: { screenId: screen.id, context: screen.context, key },
      });
    }
  }

  // 遷移先がない画面（exit以外）
  for (const [key, screen] of screens.entries()) {
    if (!screen.exit && !screensWithOutgoing.has(key)) {
      warnings.push({
        code: 'L2_INVALID_TRANSITION_TO',
        level: 'warning',
        message: `遷移先がありません: ${displayId(screen.id, screen.context)} (${key})`,
        meta: { screenId: screen.id, context: screen.context, key },
      });
    }
  }

  return warnings;
}
