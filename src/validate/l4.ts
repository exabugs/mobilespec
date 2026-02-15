import type { YamlFile } from './io.js';
import type { Screen, Transition } from './types.js';

/* ================================
 * L4: Collect State Screens
 * ================================ */

export function collectStateScreens(stateFiles: YamlFile[]): Set<string> {
  const stateScreens = new Set<string>();

  for (const file of stateFiles) {
    const doc = file.data;
    const screen = doc.screen;
    if (screen && screen.id) {
      stateScreens.add(screen.id);
    }
  }

  return stateScreens;
}

/* ================================
 * L4-L2 Cross Validation
 * ================================ */

export function validateL4L2Cross(
  stateScreens: Set<string>,
  l2Screens: Map<string, Screen>,
): string[] {
  const errors: string[] = [];

  // L4の画面IDがL2に存在するか確認
  for (const stateScreenId of stateScreens) {
    let found = false;
    for (const screen of l2Screens.values()) {
      if (screen.id === stateScreenId) {
        found = true;
        break;
      }
    }
    if (!found) {
      errors.push(
        `❌ L4-L2不整合: state screen="${stateScreenId}" に対応する L2 の画面が存在しません`,
      );
    }
  }

  return errors;
}

/* ================================
 * L4: Collect Details for cross-layer validation
 * ================================ */

export type L4Details = {
  screenId: string;
  queries: Set<string>;
  mutations: Set<string>;
  events: Record<string, any>;
};

export function collectL4Details(stateFiles: YamlFile[]): Map<string, L4Details> {
  const map = new Map<string, L4Details>();

  for (const file of stateFiles) {
    const doc = file.data;
    const screen = doc?.screen;
    const screenId = screen?.id;
    if (typeof screenId !== 'string' || screenId.length === 0) continue;

    const data = screen?.data;
    const queriesObj =
      data && typeof data === 'object' && data.queries && typeof data.queries === 'object'
        ? (data.queries as Record<string, any>)
        : {};
    const mutationsObj =
      data && typeof data === 'object' && data.mutations && typeof data.mutations === 'object'
        ? (data.mutations as Record<string, any>)
        : {};

    const eventsObj =
      screen?.events && typeof screen.events === 'object'
        ? (screen.events as Record<string, any>)
        : {};

    map.set(screenId, {
      screenId,
      queries: new Set(Object.keys(queriesObj)),
      mutations: new Set(Object.keys(mutationsObj)),
      events: eventsObj,
    });
  }

  return map;
}

/* ================================
 * Validate L4.events Cross (WARNING)
 * ================================ */

export function validateL4EventsCross(
  l4Details: Map<string, L4Details>,
  transitions: Transition[],
  l2Screens: Map<string, Screen>,
): string[] {
  const warnings: string[] = [];

  // screenId -> transitionIds（context違いは同screenIdとして集約）
  const transitionIdsByScreenId = new Map<string, Set<string>>();
  for (const t of transitions) {
    if (!t.label) continue;
    const from = l2Screens.get(t.fromKey);
    if (!from) continue;

    const set = transitionIdsByScreenId.get(from.id) ?? new Set<string>();
    set.add(t.label);
    transitionIdsByScreenId.set(from.id, set);
  }

  for (const [screenId, d] of l4Details.entries()) {
    const events = d.events ?? {};
    const l2Ids = transitionIdsByScreenId.get(screenId) ?? new Set<string>();

    // 1) L4.events のキーは L2.transitions[].id と一致すべき（なければ warning）
    for (const eventKey of Object.keys(events)) {
      if (!l2Ids.has(eventKey)) {
        warnings.push(
          `⚠️ L4.events のキーが L2.transitions に存在しません: ${screenId}.${eventKey}`,
        );
      }
    }

    // 2) callQuery/query は data.queries のキーを参照
    // 3) callMutation/mutation は data.mutations のキーを参照
    for (const [eventKey, ev] of Object.entries(events)) {
      if (!ev || typeof ev !== 'object') continue;

      const type = (ev as any).type;

      if (type === 'callQuery') {
        const q = (ev as any).query;
        if (typeof q !== 'string' || q.length === 0 || !d.queries.has(q)) {
          warnings.push(
            `⚠️ L4.events callQuery が未定義の query を参照: ${screenId}.${eventKey} -> queries.${String(q)}`,
          );
        }
      }

      if (type === 'callMutation') {
        const m = (ev as any).mutation;
        if (typeof m !== 'string' || m.length === 0 || !d.mutations.has(m)) {
          warnings.push(
            `⚠️ L4.events callMutation が未定義の mutation を参照: ${screenId}.${eventKey} -> mutations.${String(m)}`,
          );
        }
      }
    }
  }

  return warnings;
}
