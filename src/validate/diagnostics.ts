// src/validate/diagnostics.ts
import type { Diagnostic } from '../types/diagnostic.js';

/**
 * 診断生成ヘルパー関数
 */

type SchemaLabel = 'L2' | 'L3' | 'L4';

const SCHEMA_NOT_FOUND_CODE_MAP: Record<
  SchemaLabel,
  'L2_SCHEMA_NOT_FOUND' | 'L3_SCHEMA_NOT_FOUND' | 'L4_SCHEMA_NOT_FOUND'
> = {
  L2: 'L2_SCHEMA_NOT_FOUND',
  L3: 'L3_SCHEMA_NOT_FOUND',
  L4: 'L4_SCHEMA_NOT_FOUND',
};

const SCHEMA_INVALID_CODE_MAP: Record<SchemaLabel, 'L2_INVALID' | 'L3_INVALID' | 'L4_INVALID'> = {
  L2: 'L2_INVALID',
  L3: 'L3_INVALID',
  L4: 'L4_INVALID',
};

export function schemaNotFound(label: SchemaLabel, schemaPath: string): Diagnostic {
  return {
    code: SCHEMA_NOT_FOUND_CODE_MAP[label],
    level: 'error',
    message: `スキーマファイルが見つかりません: ${schemaPath}`,
    meta: { label, schemaPath },
  };
}

export function schemaError(
  label: SchemaLabel,
  filePath: string,
  instancePath: string,
  message: string
): Diagnostic {
  return {
    code: SCHEMA_INVALID_CODE_MAP[label],
    level: 'error',
    message: `${label} スキーマエラー (${filePath}): ${instancePath} ${message}`,
    meta: { label, filePath, instancePath, details: message },
  };
}

export function duplicateScreenId(
  key: string,
  id: string,
  context: string | undefined
): Diagnostic {
  return {
    code: 'L2_DUPLICATE_SCREEN_ID',
    level: 'error',
    message: `Duplicate screen key: ${key} (id=${id}, context=${context ?? 'none'})`,
    meta: { key, id, context },
  };
}

export function invalidTransitionTarget(
  fromKey: string,
  targetId: string,
  transitionId: string
): Diagnostic {
  return {
    code: 'L2_INVALID_TRANSITION_TO',
    level: 'error',
    message: `遷移先が存在しません: ${fromKey} -> ${targetId} (transition: ${transitionId})`,
    meta: { fromKey, targetId, transitionId },
  };
}

export function targetContextNotFound(
  targetId: string,
  targetContext: string,
  fromKey: string,
  transitionId: string
): Diagnostic {
  return {
    code: 'L2_INVALID_TRANSITION_TO',
    level: 'error',
    message: `targetContext not found: ${targetId}[${targetContext}] (from ${fromKey}, transition ${transitionId})`,
    meta: { targetId, targetContext, fromKey, transitionId },
  };
}

export function ambiguousTarget(
  targetId: string,
  options: string,
  fromKey: string,
  transitionId: string
): Diagnostic {
  return {
    code: 'L2_INVALID_TRANSITION_TO',
    level: 'error',
    message: `Ambiguous target: ${targetId} has multiple contexts (${options}). Please set transition.targetContext (from ${fromKey}, transition ${transitionId}).`,
    meta: { targetId, options, fromKey, transitionId },
  };
}

export function l3ActionNotInL2(
  action: string,
  screenId: string,
  context: string | undefined,
  componentId: string
): Diagnostic {
  const sk = context ? `${screenId}[${context}]` : screenId;
  return {
    code: 'L3_ACTION_NOT_IN_L2',
    level: 'error',
    message: `L3-L2不整合: action="${action}" に対応する L2 の遷移ID が存在しません (screen: ${sk}, component: ${componentId})`,
    meta: { action, screenId, context, componentId },
  };
}

export function l2TransitionNotInL4(transitionId: string, screenId: string): Diagnostic {
  return {
    code: 'L2_TRANSITION_NOT_IN_L4',
    level: 'warning',
    message: `L2-L4不整合: transition="${transitionId}" が L4.events に存在しません (screen: ${screenId})`,
    meta: { transitionId, screenId },
  };
}

export function l4UnknownQuery(queryKey: string, eventKey: string, screenId: string): Diagnostic {
  return {
    code: 'L4_UNKNOWN_QUERY',
    level: 'warning',
    message: `L4内部不整合: callQuery.query="${queryKey}" が L4.data.queries に存在しません (event: ${eventKey}, screen: ${screenId})`,
    meta: { queryKey, eventKey, screenId },
  };
}

export function l4UnknownMutation(
  mutationKey: string,
  eventKey: string,
  screenId: string
): Diagnostic {
  return {
    code: 'L4_UNKNOWN_MUTATION',
    level: 'warning',
    message: `L4内部不整合: callMutation.mutation="${mutationKey}" が L4.data.mutations に存在しません (event: ${eventKey}, screen: ${screenId})`,
    meta: { mutationKey, eventKey, screenId },
  };
}
