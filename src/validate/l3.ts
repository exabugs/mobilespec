// src/validate/l3.ts
import type { Diagnostic } from '../types/diagnostic.js';
import { l3ActionNotInL2 } from './diagnostics.js';
import type { YamlFile } from './io.js';
import { displayId, screenKey } from './keys.js';
import { type L4Details, isLocalEventType } from './l4.js';
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

      // メニュー項目の action
      if (Array.isArray(node.menu)) {
        for (const item of node.menu) {
          if (isObj(item) && typeof item.action === 'string') {
            actions.push({
              screenId,
              context,
              componentId: typeof item.id === 'string' ? item.id : '(no-id)',
              action: item.action,
            });
          }
        }
      }

      if (Array.isArray(node.children)) {
        for (const child of node.children) traverse(child);
      }

      if (isObj(node.layout) && Array.isArray(node.layout.children)) {
        for (const child of node.layout.children) traverse(child);
      }
    }

    if (isObj(screen.layout)) traverse(screen.layout);

    // ヘッダー右側のコンポーネント（headerRight）も UI。メニュー項目（menu[].action）も action を持つ
    if (Array.isArray(screen.headerRight)) {
      for (const node of screen.headerRight) traverse(node);
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
        message: `L3-L2不整合: L3 screen が L2 に存在しません (${displayId(
          screenId,
          context
        )} / key=${key})`,
        meta: { filePath: file.path, screenId, context, key },
      });
    }
  }

  return errors;
}

/* ================================
 * Validate L3-L2 Cross
 * ================================ */

export function validateL3L2Cross(
  uiActions: UIAction[],
  transitions: Transition[],
  l4Details?: Map<string, L4Details>
): Diagnostic[] {
  const errors: Diagnostic[] = [];

  // L2の遷移IDセットを作成
  const transitionIds = new Set<string>();
  for (const t of transitions) {
    if (t.label) transitionIds.add(t.label);
  }

  // L3のactionは、L2のtransition.id、または同じ画面のL4の「画面内イベント」と完全一致すること
  for (const uiAction of uiActions) {
    if (transitionIds.has(uiAction.action)) continue;
    if (l4Details && isLocalEventOf(l4Details, uiAction)) continue;
    errors.push(
      l3ActionNotInL2(uiAction.action, uiAction.screenId, uiAction.context, uiAction.componentId)
    );
  }

  return errors;
}

/** 画面内イベント（遷移を伴わない L4 イベント: update / updateState / callQuery / callMutation） */
function isLocalEventOf(l4Details: Map<string, L4Details>, a: UIAction): boolean {
  const d = l4Details.get(screenKey(a.screenId, a.context));
  const ev = d?.events?.[a.action];
  return isLocalEventType(
    ev && typeof ev === 'object' ? (ev as Record<string, unknown>).type : undefined
  );
}

/* ================================
 * L2 transitions used by L3
 *
 * Policy:
 * - unused is always info (state visibility)
 * - grouped by FROM screen (structure we can infer without project-specific words)
 * - sorted for readability
 * ================================ */

export function validateL2TransitionsUsedByL3(
  uiActions: UIAction[],
  transitions: Transition[],
  l2Screens: Map<string, Screen>
): Diagnostic[] {
  const used = new Set<string>();
  for (const a of uiActions) used.add(a.action);

  // fromLabel -> transitionIds
  const unusedByFrom = new Map<string, string[]>();

  for (const t of transitions) {
    if (!t.label) continue;
    if (used.has(t.label)) continue;

    const from = l2Screens.get(t.fromKey);
    const fromLabel = from ? displayId(from.id, from.context) : t.fromKey;

    const arr = unusedByFrom.get(fromLabel) ?? [];
    arr.push(t.label);
    unusedByFrom.set(fromLabel, arr);
  }

  if (unusedByFrom.size === 0) return [];

  const fromLabels = [...unusedByFrom.keys()].sort((a, b) => a.localeCompare(b));

  const lines: string[] = [];
  let count = 0;

  for (const fromLabel of fromLabels) {
    const ids = (unusedByFrom.get(fromLabel) ?? []).slice().sort((a, b) => a.localeCompare(b));
    count += ids.length;

    lines.push(`  ${fromLabel}`);
    for (const id of ids) lines.push(`    - ${id}`);
  }

  return [
    {
      code: 'L2_TRANSITION_UNUSED',
      level: 'info',
      message: `L2 transition が L3 から未参照:\n${lines.join('\n')}`,
      meta: { count, from: fromLabels },
    },
  ];
}
