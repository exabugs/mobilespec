// src/validate/index.ts
import fs from 'node:fs';
import path from 'path';

import { formatUnused } from '../lib/formatUnused.js';
import { openapiCheck } from '../openapiCheck.js';
import type { Diagnostic } from '../types/diagnostic.js';
import { loadConfig } from './config.js';
import { validateI18n } from './i18n.js';
import { loadYamlFiles } from './io.js';
import { collectScreensAndTransitions, validateTransitions } from './l2.js';
import {
  collectUIActions,
  validateL2TransitionsUsedByL3,
  validateL3L2Cross,
  validateL3ScreensExistInL2,
} from './l3.js';
import {
  collectL4Details,
  collectStateScreens,
  validateL4EventsCross,
  validateL4L2Cross,
} from './l4.js';
import { validateSchema } from './schema.js';
import type { ValidationResult } from './types.js';

/* ================================
 * Main Validation Function
 * ================================ */

export interface ValidateOptions {
  specsDir: string;
  schemaDir: string;
}

// diagnostics配列をValidationResultに変換
function asValidationResult(
  screens: ValidationResult['screens'],
  config: ValidationResult['config'],
  transitions: ValidationResult['transitions'],
  uiActions: ValidationResult['uiActions'],
  stateScreens: ValidationResult['stateScreens'],
  diagnostics: Diagnostic[]
): ValidationResult {
  return { screens, config, transitions, uiActions, stateScreens, diagnostics };
}

function safeRun<T>(
  fn: () => T,
  onError: (e: unknown) => Diagnostic[]
): { value: T | null; diagnostics: Diagnostic[] } {
  try {
    const v = fn();
    return { value: v, diagnostics: [] };
  } catch (e) {
    return { value: null, diagnostics: onError(e) };
  }
}

export async function validate(options: ValidateOptions): Promise<ValidationResult> {
  const SCREENFLOW_DIR = path.join(options.specsDir, 'L2.screenflows');
  const UI_DIR = path.join(options.specsDir, 'L3.ui');
  const STATE_DIR = path.join(options.specsDir, 'L4.state');
  const L2_SCHEMA_PATH = path.join(options.schemaDir, 'L2.screenflows.schema.json');
  const L3_SCHEMA_PATH = path.join(options.schemaDir, 'L3.ui.schema.json');
  const L4_SCHEMA_PATH = path.join(options.schemaDir, 'L4.state.schema.json');

  const flowFiles = loadYamlFiles(SCREENFLOW_DIR, '.flow.yaml');
  const uiFiles = loadYamlFiles(UI_DIR, '.ui.yaml');
  const stateFiles = loadYamlFiles(STATE_DIR, '.state.yaml');

  // 設定ファイル読み込み
  const config = loadConfig(options.specsDir);

  // -------------------------
  // Schema validation
  // -------------------------
  const l2SchemaErrors = validateSchema(flowFiles, L2_SCHEMA_PATH, 'L2');
  const l3SchemaErrors = validateSchema(uiFiles, L3_SCHEMA_PATH, 'L3');
  const l4SchemaErrors = validateSchema(stateFiles, L4_SCHEMA_PATH, 'L4');

  // -------------------------
  // L2
  // -------------------------
  const l2Collected = safeRun(
    () => collectScreensAndTransitions(flowFiles, config),
    (e) => [
      {
        code: 'L2_INVALID',
        level: 'error',
        message: `L2 の解析に失敗しました: ${String((e as Error)?.message ?? e)}`,
        meta: { error: String((e as Error)?.stack ?? e) },
      },
    ]
  );

  const screens = l2Collected.value?.screens ?? new Map();
  const transitions = l2Collected.value?.transitions ?? [];
  const l2Errors = l2Collected.value?.errors ?? [];
  const l2FatalDiagnostics = l2Collected.diagnostics;

  const l2Warnings = validateTransitions(screens, transitions); // 既存実装のまま
  // ここで warning を info に落とす（状態可視化の扱い）
  const l2Infos = l2Warnings.map((d) => ({ ...d, level: 'info' as const }));

  // -------------------------
  // L3
  // -------------------------
  const uiActions = collectUIActions(uiFiles);

  const l3ScreenErrors = validateL3ScreensExistInL2(uiFiles, screens);
  const crossErrors = validateL3L2Cross(uiActions, transitions);

  // unused transition（L2->L3）: 既存関数が返す diagnostics を集約して info 1件にまとめる
  const rawUnused = validateL2TransitionsUsedByL3(uiActions, transitions, screens);

  const unusedItems = rawUnused
    .filter((d) => d.code === 'L2_TRANSITION_UNUSED')
    .map((d) => {
      const meta = (d.meta ?? {}) as Record<string, unknown>;
      const fromKey = typeof meta.fromKey === 'string' ? meta.fromKey : undefined;
      const toKey = typeof meta.toKey === 'string' ? meta.toKey : undefined;
      const key =
        typeof meta.transitionId === 'string'
          ? meta.transitionId
          : fromKey && toKey
            ? `${fromKey} -> ${toKey}`
            : d.message;

      // labels を付けると formatUnused のグルーピングが効くので、
      // L2の場合は「fromKey を擬似的な root」にする（プロジェクト固有語彙ではなく、構造=from側）
      const labels = fromKey ? [`FROM ${fromKey}`] : undefined;

      return { key, labels };
    });

  const l2UnusedDiagnostics: Diagnostic[] = [];
  if (unusedItems.length) {
    const msg = formatUnused('L2 未使用 transition', unusedItems);
    l2UnusedDiagnostics.push({
      code: 'L2_TRANSITION_UNUSED',
      level: 'info',
      message: msg,
      meta: { count: unusedItems.length },
    });
  }

  // -------------------------
  // L4
  // -------------------------
  const stateScreens = collectStateScreens(stateFiles);
  const l4Errors = validateL4L2Cross(stateScreens, screens);

  const l4Details = collectL4Details(stateFiles);
  const l4EventWarnings = validateL4EventsCross(l4Details, transitions, screens);
  // 状態可視化として info 扱い
  const l4EventInfos = l4EventWarnings.map((d) => ({ ...d, level: 'info' as const }));

  // -------------------------
  // i18n
  // -------------------------
  const i18nDiagnostics = validateI18n(options.specsDir, config, screens, uiFiles);
  // （i18n は今まで通り：missing key は error、未翻訳は warning かもしれないが、
  //  “実装不能ならerror終了”に合わせるなら、未翻訳も info に落としたい場合はここで変換可能）

  // -------------------------
  // OpenAPI ↔ L4
  // -------------------------
  const openapiDiagnostics: Diagnostic[] = [];
  const openapiPathRaw = config.openapi?.path;

  if (openapiPathRaw != null) {
    if (typeof openapiPathRaw !== 'string' || openapiPathRaw.trim() === '') {
      openapiDiagnostics.push({
        code: 'OPENAPI_NOT_FOUND',
        level: 'error',
        message: 'openapi.path が不正です（空文字 or 非文字列）',
        meta: { openapiPath: openapiPathRaw },
      });
    } else {
      const resolvedOpenapiPath = path.isAbsolute(openapiPathRaw)
        ? openapiPathRaw
        : path.resolve(options.specsDir, openapiPathRaw);

      if (!fs.existsSync(resolvedOpenapiPath)) {
        openapiDiagnostics.push({
          code: 'OPENAPI_NOT_FOUND',
          level: 'error',
          message: `OpenAPI が見つかりません: ${resolvedOpenapiPath}`,
          meta: { path: resolvedOpenapiPath, raw: openapiPathRaw },
        });
      } else {
        const checkSelectRoot = config.openapi?.checkSelectRoot === true;

        const r = await openapiCheck({
          specsDir: options.specsDir,
          schemaDir: options.schemaDir,
          openapiPath: resolvedOpenapiPath,
          checkSelectRoot,
        });

        openapiDiagnostics.push(...r.diagnostics);
      }
    }
  }

  // -------------------------
  // Diagnostics merge (layer order fixed)
  // -------------------------
  const diagnostics: Diagnostic[] = [
    // L2
    ...l2SchemaErrors,
    ...l2FatalDiagnostics,
    ...l2Errors,
    ...l2Infos,
    ...l2UnusedDiagnostics,

    // L3
    ...l3SchemaErrors,
    ...l3ScreenErrors,
    ...crossErrors,

    // L4
    ...l4SchemaErrors,
    ...l4Errors,
    ...l4EventInfos,

    // i18n
    ...i18nDiagnostics,

    // OpenAPI
    ...openapiDiagnostics,
  ];

  return asValidationResult(screens, config, transitions, uiActions, stateScreens, diagnostics);
}
