import type { Diagnostic } from '../types/diagnostic.js';
import { l2TransitionUnused, l3ActionNotInL2 } from './diagnostics.js';
import type { YamlFile } from './io.js';
import { displayId, screenKey } from './keys.js';
import type { Screen, Transition, UIAction } from './types.js';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getScreenInfo(file: YamlFile): {
  screenId: string;
  context?: string;
  screen: Record<string, unknown>;
} | null {
  const doc = file.data;
  if (!isObj(doc)) return null;

  const screen = (doc as Record<string, unknown>).screen;
  if (!isObj(screen)) return null;

  const screenId = typeof screen.id === 'string' ? screen.id : '';
  if (!screenId) return null;

  const context = typeof screen.context === 'string' ? screen.context : undefined;

  return { screenId, context, screen };
}

/* ================================
 * Collect UI Actions
 * ================================ */

export function collectUIActions(uiFiles: YamlFile[]): UIAction[] {
  const actions: UIAction[] = [];

  for (const file of uiFiles) {
    const screenInfo = getScreenInfo(file);
    if (!screenInfo) continue;

    const { screenId, context, screen } = screenInfo;

    // layout.children を再帰的に探索
    function traverse(node: unknown) {
      if (!isObj(node)) return;

      if (typeof node.action === 'string') {
        actions.push({
          screenId,
          context,
          componentId: typeof node.id === 'string' ? node.id : '(no-id)',
          action: node.action,
        });
      }

      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          traverse(child);
        }
      }

      if (isObj(node.layout) && Array.isArray(node.layout.children)) {
        for (const child of node.layout.children) {
          traverse(child);
        }
      }
    }

    if (isObj(screen.layout)) {
      traverse(screen.layout);
    }
  }

  return actions;
}

/* ================================
 * Validate L3 screen exists in L2
 * ================================ */
export function validateL3ScreensExistInL2(
  uiFiles: YamlFile[],
  l2Screens: Map<string, Screen>
): Diagnostic[] {
  const errors: Diagnostic[] = [];

  for (const file of uiFiles) {
    const screenInfo = getScreenInfo(file);
    if (!screenInfo) continue;

    const { screenId, context } = screenInfo;

    const key = screenKey(screenId, context);
    if (!l2Screens.has(key)) {
      errors.push({
        code: 'L3_UNKNOWN_SCREEN',
        level: 'error',
        message: `L3-L2不整合: L3 screen が L2 に存在しません (${displayId(screenId, context)} / key=${key})`,
        meta: { filePath: file.path, screenId, context, key },
      });
    }
  }

  return errors;
}

/* ================================
 * Validate L3-L2 Cross
 * ================================ */

export function validateL3L2Cross(uiActions: UIAction[], transitions: Transition[]): Diagnostic[] {
  const errors: Diagnostic[] = [];

  // L2の遷移IDセットを作成
  const transitionIds = new Set<string>();
  for (const t of transitions) {
    if (t.label) {
      transitionIds.add(t.label);
    }
  }

  // L3のactionとL2のidが完全一致するか確認
  for (const uiAction of uiActions) {
    if (!transitionIds.has(uiAction.action)) {
      errors.push(
        l3ActionNotInL2(uiAction.action, uiAction.screenId, uiAction.context, uiAction.componentId)
      );
    }
  }

  return errors;
}

export function validateL2TransitionsUsedByL3(
  uiActions: UIAction[],
  transitions: Transition[],
  l2Screens: Map<string, Screen>
): Diagnostic[] {
  const warnings: Diagnostic[] = [];

  const used = new Set<string>();
  for (const a of uiActions) used.add(a.action);

  for (const t of transitions) {
    if (!t.label) continue;

    if (!used.has(t.label)) {
      const from = l2Screens.get(t.fromKey);
      warnings.push(l2TransitionUnused(t.label, from?.id, from?.context));
    }
  }

  return warnings;
}
