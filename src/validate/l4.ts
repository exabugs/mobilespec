import type { Diagnostic } from '../types/diagnostic.js';
import { l2TransitionNotInL4, l4UnknownMutation, l4UnknownQuery } from './diagnostics.js';
import type { YamlFile } from './io.js';
import type { Screen, Transition } from './types.js';

/* ================================
 * L4: Collect State Screens
 * ================================ */

export function collectStateScreens(stateFiles: YamlFile[]): Set<string> {
  const stateScreens = new Set<string>();

  for (const file of stateFiles) {
    const doc = file.data;
    const screen = doc.screen as Record<string, unknown> | undefined;
    if (screen && screen.id) {
      stateScreens.add(screen.id as string);
    }
  }

  return stateScreens;
}

/* ================================
 * L4-L2 Cross Validation
 * ================================ */

export function validateL4L2Cross(
  stateScreens: Set<string>,
  l2Screens: Map<string, Screen>
): Diagnostic[] {
  const errors: Diagnostic[] = [];

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
      errors.push({
        code: 'L4_UNKNOWN_SCREEN',
        level: 'error',
        message: `L4-L2不整合: state screen="${stateScreenId}" に対応する L2 の画面が存在しません`,
        meta: { screenId: stateScreenId },
      });
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
  events: Record<string, Record<string, unknown>>;
};

export function collectL4Details(stateFiles: YamlFile[]): Map<string, L4Details> {
  const map = new Map<string, L4Details>();

  for (const file of stateFiles) {
    const doc = file.data;
    const screen = doc?.screen as Record<string, unknown> | undefined;
    const screenId = screen?.id;
    if (typeof screenId !== 'string' || screenId.length === 0) continue;

    const data = screen?.data as Record<string, unknown> | undefined;
    const queriesObj =
      data?.queries && typeof data.queries === 'object' && data.queries !== null
        ? (data.queries as Record<string, unknown>)
        : {};
    const mutationsObj =
      data?.mutations && typeof data.mutations === 'object' && data.mutations !== null
        ? (data.mutations as Record<string, unknown>)
        : {};

    const eventsObj =
      screen?.events && typeof screen.events === 'object' && screen.events !== null
        ? (screen.events as Record<string, Record<string, unknown>>)
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
  l2Screens: Map<string, Screen>
): Diagnostic[] {
  const warnings: Diagnostic[] = [];

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

    const eventKeys = new Set(Object.keys(events));

    // (1) L2 にある transitionId が L4.events に無い → warning（既存 helper を正しく使う）
    for (const transitionId of l2Ids) {
      if (!eventKeys.has(transitionId)) {
        warnings.push(l2TransitionNotInL4(transitionId, screenId));
      }
    }

    // (2) L4.events にある eventKey が L2 に無い → warning（既存コード流用）
    for (const eventKey of eventKeys) {
      if (!l2Ids.has(eventKey)) {
        warnings.push({
          code: 'L3_UNKNOWN_TRANSITION',
          level: 'warning',
          message: `L4-L2不整合: L4.events["${eventKey}"] に対応する L2 transition id が存在しません (screen: ${screenId})`,
          meta: { eventKey, screenId },
        });
      }
    }

    // (3) callQuery/query は data.queries のキーを参照
    // (4) callMutation/mutation は data.mutations のキーを参照
    for (const [eventKey, ev] of Object.entries(events)) {
      if (!ev || typeof ev !== 'object') continue;

      const type = (ev as Record<string, unknown>).type;

      if (type === 'callQuery') {
        const q = (ev as Record<string, unknown>).query;
        if (typeof q !== 'string' || q.length === 0 || !d.queries.has(q)) {
          warnings.push(l4UnknownQuery(String(q), eventKey, screenId));
        }
      }

      if (type === 'callMutation') {
        const m = (ev as Record<string, unknown>).mutation;
        if (typeof m !== 'string' || m.length === 0 || !d.mutations.has(m)) {
          warnings.push(l4UnknownMutation(String(m), eventKey, screenId));
        }
      }
    }
  }

  return warnings;
}
