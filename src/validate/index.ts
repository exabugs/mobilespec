import path from 'path';
import type { ValidationResult } from './types.js';
import { loadYamlFiles } from './io.js';
import { loadConfig } from './config.js';
import { validateSchema } from './schema.js';
import { collectScreensAndTransitions, validateTransitions } from './l2.js';
import { collectUIActions, validateL3L2Cross } from './l3.js';
import {
  collectStateScreens,
  validateL4L2Cross,
  collectL4Details,
  validateL4EventsCross,
} from './l4.js';

/* ================================
 * Main Validation Function
 * ================================ */

export interface ValidateOptions {
  specsDir: string;
  schemaDir: string;
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

  // L3-L2クロスバリデーション（ここは引き続き error）
  const crossErrors = validateL3L2Cross(uiActions, transitions);

  // L4バリデーション
  const stateScreens = collectStateScreens(stateFiles);
  const l4Errors = validateL4L2Cross(stateScreens, screens);

  // L4.events (callQuery/callMutation) の cross-layer（導入期は warning）
  const l4Details = collectL4Details(stateFiles);
  const l4EventWarnings = validateL4EventsCross(l4Details, transitions, screens);

  // 診断を統合
  const diagnostics = [
    ...l2SchemaErrors,
    ...l3SchemaErrors,
    ...l4SchemaErrors,
    ...l2Errors,
    ...crossErrors,
    ...l4Errors,
    ...l2Warnings,
    ...l4EventWarnings,
  ];

  return {
    screens,
    config,
    transitions,
    uiActions,
    stateScreens,
    diagnostics,
  };
}
