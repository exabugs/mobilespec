import path from 'path';

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
    get errors() {
      return diagnostics.filter((d) => d.level === 'error');
    },
    get warnings() {
      return diagnostics.filter((d) => d.level === 'warning');
    },
  };
}

export function validate(options: ValidateOptions): ValidationResult {
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

  // L3-L2クロスバリデーション（ここは引き続き error）
  const crossErrors = validateL3L2Cross(uiActions, transitions);
  const unusedTransitionWarnings = validateL2TransitionsUsedByL3(uiActions, transitions, screens);

  // L4バリデーション
  const stateScreens = collectStateScreens(stateFiles);
  const l4Errors = validateL4L2Cross(stateScreens, screens);

  // L4.events (callQuery/callMutation) の cross-layer（導入期は warning）
  const l4Details = collectL4Details(stateFiles);
  const l4EventWarnings = validateL4EventsCross(l4Details, transitions, screens);

  // i18n 未翻訳チェック（warning）＋キー欠損（error）
  const i18nDiagnostics = validateI18n(options.specsDir, config, screens, uiFiles);

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
  ];

  return asValidationResult(screens, config, transitions, uiActions, stateScreens, diagnostics);
}
