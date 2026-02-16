// src/validate/index.ts
import fs from 'node:fs';
import path from 'path';

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

// ヘルパー関数: diagnostics配列をValidationResultに変換
function asValidationResult(
  screens: ValidationResult['screens'],
  config: ValidationResult['config'],
  transitions: ValidationResult['transitions'],
  uiActions: ValidationResult['uiActions'],
  stateScreens: ValidationResult['stateScreens'],
  diagnostics: Diagnostic[]
): ValidationResult {
  return {
    screens,
    config,
    transitions,
    uiActions,
    stateScreens,
    diagnostics,
  };
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

  // スキーマバリデーション
  const l2SchemaErrors = validateSchema(flowFiles, L2_SCHEMA_PATH, 'L2');
  const l3SchemaErrors = validateSchema(uiFiles, L3_SCHEMA_PATH, 'L3');
  const l4SchemaErrors = validateSchema(stateFiles, L4_SCHEMA_PATH, 'L4');

  // L2バリデーション
  const {
    screens,
    transitions,
    errors: l2Errors,
  } = collectScreensAndTransitions(flowFiles, config);
  const l2Warnings = validateTransitions(screens, transitions);

  // L3バリデーション
  const uiActions = collectUIActions(uiFiles);

  // L3 → L2: screen が L2 に存在するか（error）
  const l3ScreenErrors = validateL3ScreensExistInL2(uiFiles, screens);

  // L3-L2クロスバリデーション
  const crossErrors = validateL3L2Cross(uiActions, transitions);
  const unusedTransitionWarnings = validateL2TransitionsUsedByL3(uiActions, transitions, screens);

  // L4バリデーション
  const stateScreens = collectStateScreens(stateFiles);
  const l4Errors = validateL4L2Cross(stateScreens, screens);

  // L4.events cross-layer（導入期は warning）
  const l4Details = collectL4Details(stateFiles);
  const l4EventWarnings = validateL4EventsCross(l4Details, transitions, screens);

  // i18n 未翻訳チェック（warning）＋キー欠損（error）
  const i18nDiagnostics = validateI18n(options.specsDir, config, screens, uiFiles);

  // OpenAPI ↔ L4
  const openapiDiagnostics: Diagnostic[] = [];
  const openapiPathRaw = config.openapi?.path;

  if (openapiPathRaw != null) {
    // 「openapi が設定されている」＝厳格に扱う（空や不正も error）
    if (typeof openapiPathRaw !== 'string' || openapiPathRaw.trim() === '') {
      openapiDiagnostics.push({
        code: 'OPENAPI_NOT_FOUND',
        level: 'error',
        message: 'openapi.path が不正です（空文字 or 非文字列）',
        meta: { openapiPath: openapiPathRaw },
      });
    } else {
      // ★ path.resolve に変更（.. を正規化）
      const resolvedOpenapiPath = path.isAbsolute(openapiPathRaw)
        ? openapiPathRaw
        : path.resolve(options.specsDir, openapiPathRaw);

      // ★ 指定があるのにファイルがないなら error
      if (!fs.existsSync(resolvedOpenapiPath)) {
        openapiDiagnostics.push({
          code: 'OPENAPI_NOT_FOUND',
          level: 'error',
          message: `OpenAPI が見つかりません: ${resolvedOpenapiPath}`,
          meta: { path: resolvedOpenapiPath, raw: openapiPathRaw },
        });
      } else {
        const warnUnusedOperationId = config.openapi?.warnUnusedOperationId !== false; // default true
        const checkSelectRoot = config.openapi?.checkSelectRoot === true; // default false

        const r = await openapiCheck({
          specsDir: options.specsDir,
          schemaDir: options.schemaDir,
          openapiPath: resolvedOpenapiPath,
          warnUnusedOperationId,
          checkSelectRoot,
        });

        openapiDiagnostics.push(...r.diagnostics);
      }
    }
  }

  // 診断を統合
  const diagnostics = [
    ...l2SchemaErrors,
    ...l3SchemaErrors,
    ...l4SchemaErrors,
    ...l2Errors,
    ...l3ScreenErrors,
    ...crossErrors,
    ...l4Errors,
    ...l2Warnings,
    ...unusedTransitionWarnings,
    ...l4EventWarnings,
    ...i18nDiagnostics,
    ...openapiDiagnostics,
  ];

  return asValidationResult(screens, config, transitions, uiActions, stateScreens, diagnostics);
}
