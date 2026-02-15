import type { YamlFile } from './io.js';
import type { UIAction, Transition } from './types.js';
import type { Diagnostic } from '../types/diagnostic.js';
import { l3ActionNotInL2 } from './diagnostics.js';

/* ================================
 * Collect UI Actions
 * ================================ */

export function collectUIActions(uiFiles: YamlFile[]): UIAction[] {
  const actions: UIAction[] = [];

  for (const file of uiFiles) {
    const doc = file.data;
    const screen = doc.screen;
    if (!screen) continue;

    const screenId = screen.id;
    const context = typeof screen.context === 'string' ? screen.context : undefined;

    // layout.children を再帰的に探索
    function traverse(node: Record<string, unknown>) {
      if (!node) return;

      if (node.action && typeof node.action === 'string') {
        actions.push({
          screenId,
          context,
          componentId: node.id as string,
          action: node.action,
        });
      }

      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          traverse(child);
        }
      }

      if (node.layout && typeof node.layout === 'object' && node.layout !== null) {
        const layout = node.layout as Record<string, unknown>;
        if (layout.children && Array.isArray(layout.children)) {
          for (const child of layout.children) {
            traverse(child);
          }
        }
      }
    }

    if (screen.layout) {
      traverse(screen.layout);
    }
  }

  return actions;
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
      errors.push(l3ActionNotInL2(uiAction.action, uiAction.screenId, uiAction.context, uiAction.componentId));
    }
  }

  return errors;
}
