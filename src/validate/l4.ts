// l4.ts
import type { Diagnostic } from '../types/diagnostic.js';
import { l2TransitionNotInL4, l4UnknownMutation, l4UnknownQuery } from './diagnostics.js';
import type { YamlFile } from './io.js';
import { displayId, screenKey } from './keys.js';
import type { Screen, Transition } from './types.js';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getScreenIdAndContext(file: YamlFile): { screenId: string; context?: string } | null {
  const doc = file.data;
  if (!isObj(doc)) return null;

  const screen = doc.screen;
  if (!isObj(screen)) return null;

  const screenId = typeof screen.id === 'string' ? screen.id : '';
  if (!screenId) return null;

  const context = typeof screen.context === 'string' ? screen.context : undefined;

  return { screenId, context };
}

/* ================================
 * L4: Collect State Screens
 * ================================ */

export function collectStateScreens(stateFiles: YamlFile[]): Set<string> {
  const stateScreens = new Set<string>();

  for (const file of stateFiles) {
    const info = getScreenIdAndContext(file);
    if (!info) continue;

    const key = screenKey(info.screenId, info.context);
    stateScreens.add(key);
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

  // L4 の screenKey が L2 に存在するか確認
  for (const stateScreenKey of stateScreens) {
    if (!l2Screens.has(stateScreenKey)) {
      errors.push({
        code: 'L4_UNKNOWN_SCREEN',
        level: 'error',
        message: `L4-L2不整合: state screenKey="${stateScreenKey}" に対応する L2 の画面が存在しません`,
        meta: { screenKey: stateScreenKey },
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
  context?: string;
  screenKey: string;
  queries: Set<string>;
  mutations: Set<string>;
  events: Record<string, Record<string, unknown>>;
};

export function collectL4Details(stateFiles: YamlFile[]): Map<string, L4Details> {
  const map = new Map<string, L4Details>();

  for (const file of stateFiles) {
    const doc = file.data;
    const screen = isObj(doc) && isObj(doc.screen) ? (doc.screen as Record<string, unknown>) : null;
    if (!screen) continue;

    const screenId = typeof screen.id === 'string' ? screen.id : '';
    if (!screenId) continue;

    const context = typeof screen.context === 'string' ? screen.context : undefined;
    const sk = screenKey(screenId, context);

    const data = isObj(screen.data) ? (screen.data as Record<string, unknown>) : undefined;

    const queriesObj =
      data?.queries && typeof data.queries === 'object' && data.queries !== null
        ? (data.queries as Record<string, unknown>)
        : {};

    const mutationsObj =
      data?.mutations && typeof data.mutations === 'object' && data.mutations !== null
        ? (data.mutations as Record<string, unknown>)
        : {};

    const eventsObj =
      screen.events && typeof screen.events === 'object' && screen.events !== null
        ? (screen.events as Record<string, Record<string, unknown>>)
        : {};

    map.set(sk, {
      screenId,
      context,
      screenKey: sk,
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

  // screenKey -> transitionIds（context込みで分離）
  const transitionIdsByScreenKey = new Map<string, Set<string>>();
  for (const t of transitions) {
    if (!t.label) continue;

    // transitions は fromKey を持っている前提（screenKey）
    const fromKey = t.fromKey;
    const from = l2Screens.get(fromKey);
    if (!from) continue;

    const set = transitionIdsByScreenKey.get(fromKey) ?? new Set<string>();
    set.add(t.label);
    transitionIdsByScreenKey.set(fromKey, set);
  }

  for (const [sk, d] of l4Details.entries()) {
    const events = d.events ?? {};
    const l2Ids = transitionIdsByScreenKey.get(sk) ?? new Set<string>();

    const eventKeys = new Set(Object.keys(events));
    const screenDisp = displayId(d.screenId, d.context);

    // (1) L2 にある transitionId が L4.events に無い
    for (const transitionId of l2Ids) {
      if (!eventKeys.has(transitionId)) {
        // 既存 helper の第2引数は screenId なので、表示用に加工して渡す（互換維持）
        warnings.push(l2TransitionNotInL4(transitionId, screenDisp));
      }
    }

    // (2) L4.events にある eventKey が L2 に無い
    for (const eventKey of eventKeys) {
      if (!l2Ids.has(eventKey)) {
        warnings.push({
          code: 'L3_UNKNOWN_TRANSITION',
          level: 'warning',
          message: `L4-L2不整合: L4.events["${eventKey}"] に対応する L2 transition id が存在しません (screen: ${screenDisp})`,
          meta: { eventKey, screenId: d.screenId, context: d.context, screenKey: sk },
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
          warnings.push(l4UnknownQuery(String(q), eventKey, screenDisp));
        }
      }

      if (type === 'callMutation') {
        const m = (ev as Record<string, unknown>).mutation;
        if (typeof m !== 'string' || m.length === 0 || !d.mutations.has(m)) {
          warnings.push(l4UnknownMutation(String(m), eventKey, screenDisp));
        }
      }
    }
  }

  return warnings;
}
