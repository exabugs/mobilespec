// Mobile App Specification Validator (L2/L3/L4)

import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import Ajv from 'ajv/dist/2020.js';

/* ================================
 * Constants
 * ================================ */

export const GROUP_ORDER = {
  Home: 1,
  Task: 2,
  Venue: 3,
  Misc: 99,
} as const;

type GroupName = keyof typeof GROUP_ORDER;

/* ================================
 * Types
 * ================================ */

export type Screen = {
  id: string;
  name: string;
  group: GroupName;
  order?: number;
  entry?: boolean;
  exit?: boolean;
  context?: string;
};

export type Transition = {
  fromKey: string;
  toKey: string;
  label?: string;
  self?: boolean;
};

export type UIAction = {
  screenId: string;
  context?: string;
  componentId: string;
  action: string;
};

export type ValidationResult = {
  screens: Map<string, Screen>;
  transitions: Transition[];
  uiActions: UIAction[];
  stateScreens: Set<string>;
  errors: string[];
  warnings: string[];
};

/* ================================
 * Helpers
 * ================================ */

function screenKey(id: string, context?: string): string {
  return context ? `${id}__${context}` : id;
}

function displayId(id: string, context?: string): string {
  return context ? `${id}[${context}]` : id;
}

/* ================================
 * Load YAML Files
 * ================================ */

type YamlFile = {
  path: string;
  data: any;
};

function loadYamlFiles(dir: string, extension: string): YamlFile[] {
  const results: YamlFile[] = [];

  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...loadYamlFiles(fullPath, extension));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      const data = yaml.load(fs.readFileSync(fullPath, 'utf-8'));
      results.push({ path: fullPath, data });
    }
  }

  return results;
}

/* ================================
 * Schema Validation
 * ================================ */

function validateSchema(files: YamlFile[], schemaPath: string, label: string): string[] {
  const errors: string[] = [];

  if (!fs.existsSync(schemaPath)) {
    errors.push(`❌ スキーマファイルが見つかりません: ${schemaPath}`);
    return errors;
  }

  const schemaData = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schemaData);

  for (const file of files) {
    const valid = validate(file.data);
    if (!valid && validate.errors) {
      for (const err of validate.errors) {
        const path = err.instancePath || '/';
        const message = err.message || 'unknown error';
        errors.push(`❌ ${label} スキーマエラー (${file.path}): ${path} ${message}`);
      }
    }
  }

  return errors;
}

/* ================================
 * Collect Screens and Transitions
 * ================================ */

function collectScreensAndTransitions(files: YamlFile[]): {
  screens: Map<string, Screen>;
  transitions: Transition[];
  errors: string[];
} {
  const screens = new Map<string, Screen>();
  const variantsById = new Map<string, Screen[]>();
  const errors: string[] = [];

  // screen を全部集める
  for (const file of files) {
    const doc = file.data;
    const screen = doc.screen;
    if (!screen) continue;

    if (!(screen.group in GROUP_ORDER)) {
      errors.push(`❌ Unknown group: ${screen.group} (screen: ${screen.id})`);
      continue;
    }

    const s: Screen = {
      id: screen.id,
      name: screen.name,
      group: screen.group as GroupName,
      order: screen.order,
      entry: screen.entry === true,
      exit: screen.exit === true,
      context: typeof screen.context === 'string' ? screen.context : undefined,
    };

    const key = screenKey(s.id, s.context);
    if (screens.has(key)) {
      errors.push(
        `❌ Duplicate screen key: ${key} (id=${s.id}, context=${s.context ?? 'none'})`
      );
      continue;
    }

    screens.set(key, s);

    if (!variantsById.has(s.id)) variantsById.set(s.id, []);
    variantsById.get(s.id)!.push(s);
  }

  // transitions を集める
  const transitions: Transition[] = [];

  for (const file of files) {
    const doc = file.data;
    const screen = doc.screen;
    if (!screen) continue;

    const fromContext = typeof screen.context === 'string' ? screen.context : undefined;
    const fromKey = screenKey(screen.id, fromContext);

    for (const t of screen.transitions ?? []) {
      const targetId: string = t.target;
      const targetContext: string | undefined =
        typeof t.targetContext === 'string' ? t.targetContext : undefined;

      const candidates = variantsById.get(targetId) ?? [];
      if (candidates.length === 0) {
        errors.push(
          `❌ 遷移先が存在しません: ${fromKey} -> ${targetId} (transition: ${t.id})`
        );
        continue;
      }

      let toKey: string;

      if (targetContext) {
        const hit = candidates.find((s) => s.context === targetContext);
        if (!hit) {
          errors.push(
            `❌ targetContext not found: ${targetId}[${targetContext}] (from ${fromKey}, transition ${t.id})`
          );
          continue;
        }
        toKey = screenKey(hit.id, hit.context);
      } else if (candidates.length === 1) {
        const only = candidates[0];
        toKey = screenKey(only.id, only.context);
      } else {
        const opts = candidates.map((s) => displayId(s.id, s.context)).join(', ');
        errors.push(
          `❌ Ambiguous target: ${targetId} has multiple contexts (${opts}). ` +
            `Please set transition.targetContext (from ${fromKey}, transition ${t.id}).`
        );
        continue;
      }

      transitions.push({
        fromKey,
        toKey,
        label: t.id,
        self: fromKey === toKey,
      });
    }
  }

  return { screens, transitions, errors };
}

/* ================================
 * Validate Transitions
 * ================================ */

function validateTransitions(
  screens: Map<string, Screen>,
  transitions: Transition[]
): string[] {
  const warnings: string[] = [];
  const screensWithIncoming = new Set<string>();
  const screensWithOutgoing = new Set<string>();

  // 遷移の存在チェック
  for (const t of transitions) {
    screensWithOutgoing.add(t.fromKey);
    screensWithIncoming.add(t.toKey);
  }

  // 遷移元がない画面（entry以外）
  for (const [key, screen] of screens.entries()) {
    if (!screen.entry && !screensWithIncoming.has(key)) {
      warnings.push(
        `⚠️  遷移元がありません: ${displayId(screen.id, screen.context)} (${key})`
      );
    }
  }

  // 遷移先がない画面（exit以外）
  for (const [key, screen] of screens.entries()) {
    if (!screen.exit && !screensWithOutgoing.has(key)) {
      warnings.push(
        `⚠️  遷移先がありません: ${displayId(screen.id, screen.context)} (${key})`
      );
    }
  }

  return warnings;
}

/* ================================
 * Collect UI Actions
 * ================================ */

function collectUIActions(uiFiles: YamlFile[]): UIAction[] {
  const actions: UIAction[] = [];

  for (const file of uiFiles) {
    const doc = file.data;
    const screen = doc.screen;
    if (!screen) continue;

    const screenId = screen.id;
    const context = typeof screen.context === 'string' ? screen.context : undefined;

    // layout.children を再帰的に探索
    function traverse(node: any) {
      if (!node) return;

      if (node.action && typeof node.action === 'string') {
        actions.push({
          screenId,
          context,
          componentId: node.id,
          action: node.action,
        });
      }

      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          traverse(child);
        }
      }

      if (node.layout && node.layout.children && Array.isArray(node.layout.children)) {
        for (const child of node.layout.children) {
          traverse(child);
        }
      }
    }

    if (screen.layout) {
      traverse(screen.layout);
    }
  }

  return actions;
}

/* ================================
 * Validate L3-L2 Cross
 * ================================ */

function validateL3L2Cross(
  uiActions: UIAction[],
  transitions: Transition[]
): string[] {
  const errors: string[] = [];

  // L2の遷移IDセットを作成
  const transitionIds = new Set<string>();
  for (const t of transitions) {
    if (t.label) {
      transitionIds.add(t.label);
    }
  }

  // L3のactionとL2のidが完全一致するか確認
  for (const uiAction of uiActions) {
    if (!transitionIds.has(uiAction.action)) {
      const screenKey = uiAction.context
        ? `${uiAction.screenId}[${uiAction.context}]`
        : uiAction.screenId;

      errors.push(
        `❌ L3-L2不整合: action="${uiAction.action}" に対応する L2 の遷移ID が存在しません ` +
          `(screen: ${screenKey}, component: ${uiAction.componentId})`
      );
    }
  }

  return errors;
}

/* ================================
 * Main Validation Function
 * ================================ */

export interface ValidateOptions {
  specsDir: string;
  schemaDir: string;
}

export function validate(options: ValidateOptions): ValidationResult {
  const SCREENFLOW_DIR = path.join(options.specsDir, 'screenflows');
  const UI_DIR = path.join(options.specsDir, 'ui');
  const STATE_DIR = path.join(options.specsDir, 'state');
  const L2_SCHEMA_PATH = path.join(options.schemaDir, 'L2.screenflows.schema.json');
  const L3_SCHEMA_PATH = path.join(options.schemaDir, 'L3.ui.schema.json');
  const L4_SCHEMA_PATH = path.join(options.schemaDir, 'L4.state.schema.json');

  const flowFiles = loadYamlFiles(SCREENFLOW_DIR, '.flow.yaml');
  const uiFiles = loadYamlFiles(UI_DIR, '.ui.yaml');
  const stateFiles = loadYamlFiles(STATE_DIR, '.state.yaml');

  // スキーマバリデーション
  const l2SchemaErrors = validateSchema(flowFiles, L2_SCHEMA_PATH, 'L2');
  const l3SchemaErrors = validateSchema(uiFiles, L3_SCHEMA_PATH, 'L3');
  const l4SchemaErrors = validateSchema(stateFiles, L4_SCHEMA_PATH, 'L4');

  // L2バリデーション
  const { screens, transitions, errors: l2Errors } = collectScreensAndTransitions(flowFiles);
  const warnings = validateTransitions(screens, transitions);

  // L3バリデーション
  const uiActions = collectUIActions(uiFiles);

  // L3-L2クロスバリデーション
  const crossErrors = validateL3L2Cross(uiActions, transitions);

  // L4バリデーション
  const stateScreens = collectStateScreens(stateFiles);
  const l4Errors = validateL4L2Cross(stateScreens, screens);

  return {
    screens,
    transitions,
    uiActions,
    stateScreens,
    errors: [...l2SchemaErrors, ...l3SchemaErrors, ...l4SchemaErrors, ...l2Errors, ...crossErrors, ...l4Errors],
    warnings,
  };
}

/* ================================
 * L4: Collect State Screens
 * ================================ */

function collectStateScreens(stateFiles: YamlFile[]): Set<string> {
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

function validateL4L2Cross(
  stateScreens: Set<string>,
  l2Screens: Map<string, Screen>
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
        `❌ L4-L2不整合: state screen="${stateScreenId}" に対応する L2 の画面が存在しません`
      );
    }
  }

  return errors;
}

