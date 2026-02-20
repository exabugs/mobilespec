// src/validate/index.ts
import fs from 'node:fs';
import path from 'path';

import { openapiCheck } from '../openapiCheck.js';
import type { Diagnostic } from '../types/diagnostic.js';
import { loadConfig } from './config.js';
import { loadL2Guards } from './guards.js';
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

export interface ValidateOptions {
  specsDir: string;
  schemaDir: string;
}

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
    return { value: fn(), diagnostics: [] };
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

  const config = loadConfig(options.specsDir);
  const { ids: guardIds } = loadL2Guards(options.specsDir);

  // -------------------------
  // Schema validation
  // -------------------------
  const l2SchemaDiagnostics = validateSchema(flowFiles, L2_SCHEMA_PATH, 'L2');
  const l3SchemaDiagnostics = validateSchema(uiFiles, L3_SCHEMA_PATH, 'L3');
  const l4SchemaDiagnostics = validateSchema(stateFiles, L4_SCHEMA_PATH, 'L4');

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
  const l2Fatal = l2Collected.diagnostics;

  // L2: policy is decided inside l2.ts (error/info)
  const l2TransitionDiagnostics = validateTransitions(screens, transitions, guardIds);

  // -------------------------
  // L3
  // -------------------------
  const uiActions = collectUIActions(uiFiles);

  const l3ScreenErrors = validateL3ScreensExistInL2(uiFiles, screens);
  const l3L2CrossErrors = validateL3L2Cross(uiActions, transitions);

  // L2 unused transitions (by L3) are already aggregated as info in l3.ts
  const l2UnusedDiagnostics = validateL2TransitionsUsedByL3(uiActions, transitions, screens);

  // -------------------------
  // L4
  // -------------------------
  const stateScreens = collectStateScreens(stateFiles);
  const l4L2Errors = validateL4L2Cross(stateScreens, screens);

  const l4Details = collectL4Details(stateFiles);
  // L4: policy is decided inside l4.ts (error/info)
  const l4EventDiagnostics = validateL4EventsCross(l4Details, transitions, screens);

  // -------------------------
  // i18n
  // -------------------------
  const i18nDiagnostics = validateI18n(options.specsDir, config, screens, uiFiles);

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
        const r = await openapiCheck({
          specsDir: options.specsDir,
          schemaDir: options.schemaDir,
          openapiPath: resolvedOpenapiPath,
        });
        openapiDiagnostics.push(...r.diagnostics);
      }
    }
  }

  // -------------------------
  // Merge (layer order fixed)
  // -------------------------
  const diagnostics: Diagnostic[] = [
    // L2
    ...l2SchemaDiagnostics,
    ...l2Fatal,
    ...l2Errors,
    ...l2TransitionDiagnostics,

    // L3 (includes L2 unused by L3)
    ...l3SchemaDiagnostics,
    ...l3ScreenErrors,
    ...l3L2CrossErrors,
    ...l2UnusedDiagnostics,

    // L4
    ...l4SchemaDiagnostics,
    ...l4L2Errors,
    ...l4EventDiagnostics,

    // i18n
    ...i18nDiagnostics,

    // OpenAPI
    ...openapiDiagnostics,
  ];

  return asValidationResult(screens, config, transitions, uiActions, stateScreens, diagnostics);
}
