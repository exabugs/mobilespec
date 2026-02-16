// src/validate/l4.ts
import type { Diagnostic } from '../types/diagnostic.js';
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
 * Validate L4.events Cross
 *
 * Policy:
 * - Missing event handlers / stale event keys are "state" => info
 * - callQuery/callMutation with unknown query/mutation is "implementation impossible" => error
 * - Output is aggregated (multi-line) for readability
 * ================================ */

export function validateL4EventsCross(
  l4Details: Map<string, L4Details>,
  transitions: Transition[],
  _l2Screens: Map<string, Screen>
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // screenKey -> transitionIds
  const transitionIdsByScreenKey = new Map<string, Set<string>>();
  for (const t of transitions) {
    if (!t.label) continue;
    const fromKey = t.fromKey;

    const set = transitionIdsByScreenKey.get(fromKey) ?? new Set<string>();
    set.add(t.label);
    transitionIdsByScreenKey.set(fromKey, set);
  }

  // Aggregation buckets
  const missingHandlersByScreen = new Map<string, string[]>(); // L2 has id but L4.events missing
  const staleEventKeysByScreen = new Map<string, string[]>(); // L4.events has key but L2 missing
  const unknownQueryByScreen = new Map<string, { eventKey: string; query: string }[]>();
  const unknownMutationByScreen = new Map<string, { eventKey: string; mutation: string }[]>();

  for (const [sk, d] of l4Details.entries()) {
    const events = d.events ?? {};
    const l2Ids = transitionIdsByScreenKey.get(sk) ?? new Set<string>();

    const eventKeys = new Set(Object.keys(events));
    const screenDisp = displayId(d.screenId, d.context);

    // (1) L2 transitionId exists but no L4.events handler
    for (const transitionId of l2Ids) {
      if (!eventKeys.has(transitionId)) {
        const arr = missingHandlersByScreen.get(screenDisp) ?? [];
        arr.push(transitionId);
        missingHandlersByScreen.set(screenDisp, arr);
      }
    }

    // (2) L4.events key exists but no L2 transition id
    for (const eventKey of eventKeys) {
      if (!l2Ids.has(eventKey)) {
        const arr = staleEventKeysByScreen.get(screenDisp) ?? [];
        arr.push(eventKey);
        staleEventKeysByScreen.set(screenDisp, arr);
      }
    }

    // (3)(4) callQuery / callMutation must reference existing keys
    for (const [eventKey, ev] of Object.entries(events)) {
      if (!ev || typeof ev !== 'object') continue;

      const type = (ev as Record<string, unknown>).type;

      if (type === 'callQuery') {
        const q = (ev as Record<string, unknown>).query;
        const qStr = typeof q === 'string' ? q : String(q);
        if (!qStr || !d.queries.has(qStr)) {
          const arr = unknownQueryByScreen.get(screenDisp) ?? [];
          arr.push({ eventKey, query: qStr });
          unknownQueryByScreen.set(screenDisp, arr);
        }
      }

      if (type === 'callMutation') {
        const m = (ev as Record<string, unknown>).mutation;
        const mStr = typeof m === 'string' ? m : String(m);
        if (!mStr || !d.mutations.has(mStr)) {
          const arr = unknownMutationByScreen.get(screenDisp) ?? [];
          arr.push({ eventKey, mutation: mStr });
          unknownMutationByScreen.set(screenDisp, arr);
        }
      }
    }
  }

  // Emit info: missing handlers
  if (missingHandlersByScreen.size) {
    const screens = [...missingHandlersByScreen.keys()].sort((a, b) => a.localeCompare(b));
    const lines: string[] = [];
    for (const s of screens) {
      const ids = (missingHandlersByScreen.get(s) ?? []).slice().sort((a, b) => a.localeCompare(b));
      lines.push(`  ${s}`);
      for (const id of ids) lines.push(`    - ${id}`);
    }
    diagnostics.push({
      code: 'L2_TRANSITION_NOT_IN_L4',
      level: 'info',
      message: `L2 transition が L4.events に未定義（状態）:\n${lines.join('\n')}`,
      meta: {
        screens,
        count: [...missingHandlersByScreen.values()].reduce((a, b) => a + b.length, 0),
      },
    });
  }

  // Emit info: stale event keys
  if (staleEventKeysByScreen.size) {
    const screens = [...staleEventKeysByScreen.keys()].sort((a, b) => a.localeCompare(b));
    const lines: string[] = [];
    for (const s of screens) {
      const keys = (staleEventKeysByScreen.get(s) ?? []).slice().sort((a, b) => a.localeCompare(b));
      lines.push(`  ${s}`);
      for (const k of keys) lines.push(`    - ${k}`);
    }
    diagnostics.push({
      code: 'L3_UNKNOWN_TRANSITION',
      level: 'info',
      message: `L4.events に存在するが L2 に存在しない eventKey（状態）:\n${lines.join('\n')}`,
      meta: {
        screens,
        count: [...staleEventKeysByScreen.values()].reduce((a, b) => a + b.length, 0),
      },
    });
  }

  // Emit error: unknown query references
  if (unknownQueryByScreen.size) {
    const screens = [...unknownQueryByScreen.keys()].sort((a, b) => a.localeCompare(b));
    const lines: string[] = [];
    for (const s of screens) {
      const items = (unknownQueryByScreen.get(s) ?? []).slice().sort((a, b) => {
        const ak = `${a.eventKey}:${a.query}`;
        const bk = `${b.eventKey}:${b.query}`;
        return ak.localeCompare(bk);
      });
      lines.push(`  ${s}`);
      for (const it of items) lines.push(`    - ${it.eventKey}: query=${it.query}`);
    }
    diagnostics.push({
      code: 'L4_UNKNOWN_QUERY',
      level: 'error',
      message: `L4.events(callQuery) が data.queries に存在しない query を参照（実装不能）:\n${lines.join('\n')}`,
      meta: { screens },
    });
  }

  // Emit error: unknown mutation references
  if (unknownMutationByScreen.size) {
    const screens = [...unknownMutationByScreen.keys()].sort((a, b) => a.localeCompare(b));
    const lines: string[] = [];
    for (const s of screens) {
      const items = (unknownMutationByScreen.get(s) ?? []).slice().sort((a, b) => {
        const ak = `${a.eventKey}:${a.mutation}`;
        const bk = `${b.eventKey}:${b.mutation}`;
        return ak.localeCompare(bk);
      });
      lines.push(`  ${s}`);
      for (const it of items) lines.push(`    - ${it.eventKey}: mutation=${it.mutation}`);
    }
    diagnostics.push({
      code: 'L4_UNKNOWN_MUTATION',
      level: 'error',
      message: `L4.events(callMutation) が data.mutations に存在しない mutation を参照（実装不能）:\n${lines.join('\n')}`,
      meta: { screens },
    });
  }

  return diagnostics;
}
