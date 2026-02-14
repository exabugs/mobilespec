// src/validate.ts
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import yaml from 'js-yaml';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ajv/dist/2020 は環境によって default を持つ/持たないので両対応
const Ajv2020 = (require('ajv/dist/2020') as any).default ?? require('ajv/dist/2020');

export type ValidateOptions = { specsDir: string; schemaDir: string };
export type ValidationResult = { errors: string[]; warnings: string[] };

type L2Doc = {
  screen: {
    id: string; // screen_...
    name: string;
    type: 'screen';
    context?: string;
    entry?: boolean;
    exit?: boolean;
    transitions: Array<{
      id: string; // action_xxx
      trigger: 'tap' | 'auto';
      target: string; // screen_...
      targetContext?: string;
    }>;
  };
};

type L3Doc = {
  screen: {
    id: string; // screen_...
    context?: string;
    layout: any;
  };
};

type L4Doc = {
  screen: {
    id: string; // screen_...
    states?: Array<any>;
    data?: any;
    events?: Record<string, any>; // key = action_xxx
    conditions?: Record<string, string>;
  };
};

type MobileSpecConfig = {
  mermaid: { groupOrder: string[]; screenOrder?: string[] };
  validation?: {
    allowNoIncoming?: string[]; // screen id or screen key
  };
};

function readYaml<T>(p: string): T {
  return yaml.load(fs.readFileSync(p, 'utf8')) as T;
}

function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function screenKey(id: string, context?: string) {
  return context ? `${id}__${context}` : id;
}

function walkNodes(node: any, visit: (n: any) => void) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  if (Array.isArray(node.children)) {
    for (const c of node.children) walkNodes(c, visit);
  }
  if (node.layout) walkNodes(node.layout, visit);
}

function loadConfig(specsDir: string): MobileSpecConfig {
  const p = path.join(specsDir, 'mobilespec.config.yml');
  if (!fs.existsSync(p)) return { mermaid: { groupOrder: [] } };
  const obj = yaml.load(fs.readFileSync(p, 'utf8')) as any;
  return {
    mermaid: obj.mermaid ?? { groupOrder: [] },
    validation: obj.validation ?? {},
  };
}

export async function validate(options: ValidateOptions): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const cfg = loadConfig(options.specsDir);
  const allowNoIncoming = new Set(cfg.validation?.allowNoIncoming ?? []);

  // directories (fixed for now)
  const L2_DIR = path.join(options.specsDir, 'L2.screenflows');
  const L3_DIR = path.join(options.specsDir, 'L3.ui');
  const L4_DIR = path.join(options.specsDir, 'L4.state');

  // schemas
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const s2 = readJson(path.join(options.schemaDir, 'L2.screenflows.schema.json'));
  const s3 = readJson(path.join(options.schemaDir, 'L3.ui.schema.json'));
  const s4 = readJson(path.join(options.schemaDir, 'L4.state.schema.json'));
  const sc = readJson(path.join(options.schemaDir, 'mobilespec.config.schema.json'));

  const v2 = ajv.compile(s2);
  const v3 = ajv.compile(s3);
  const v4 = ajv.compile(s4);
  const vc = ajv.compile(sc);

  if (!vc(cfg)) {
    errors.push(`🔴 mobilespec.config.yml invalid: ${ajv.errorsText(vc.errors)}`);
    return { errors, warnings };
  }

  // collect files (if dir missing -> empty)
  const l2Files = fs.existsSync(L2_DIR)
    ? fg.sync(['**/*.flow.yaml'], { cwd: L2_DIR, absolute: true })
    : [];
  const l3Files = fs.existsSync(L3_DIR)
    ? fg.sync(['**/*.ui.yaml'], { cwd: L3_DIR, absolute: true })
    : [];
  const l4Files = fs.existsSync(L4_DIR)
    ? fg.sync(['**/*.state.yaml'], { cwd: L4_DIR, absolute: true })
    : [];

  if (l2Files.length === 0) {
    errors.push('🔴 L2.screenflows が見つかりません（最低1つの .flow.yaml が必要）');
    return { errors, warnings };
  }

  // ---------- L2 parse ----------
  const l2Screens = new Map<string, L2Doc['screen']>(); // key -> screen
  const l2TransitionsByScreen = new Map<string, Set<string>>(); // screenKey -> set(actionId)
  const l2Incoming = new Set<string>();
  const l2Outgoing = new Set<string>();

  for (const f of l2Files) {
    const doc = readYaml<L2Doc>(f);
    if (!v2(doc)) {
      errors.push(
        `🔴 L2 invalid: ${path.relative(options.specsDir, f)}: ${ajv.errorsText(v2.errors)}`,
      );
      continue;
    }
    const s = doc.screen;
    const key = screenKey(s.id, s.context);
    l2Screens.set(key, s);

    const set = l2TransitionsByScreen.get(key) ?? new Set<string>();
    for (const t of s.transitions) {
      set.add(t.id);
      l2Outgoing.add(key);
      l2Incoming.add(screenKey(t.target, t.targetContext));
    }
    l2TransitionsByScreen.set(key, set);
  }

  // L2: target existence
  for (const [fromKey, s] of l2Screens.entries()) {
    for (const t of s.transitions) {
      const toKey = screenKey(t.target, t.targetContext);
      if (!l2Screens.has(toKey)) {
        errors.push(`🔴 L2 transition target not found: ${fromKey} --(${t.id})-> ${toKey}`);
      }
    }
  }

  // L2: no-incoming check (entry 제외)
  for (const [key, s] of l2Screens.entries()) {
    if (s.entry) continue;
    if (l2Incoming.has(key)) continue;
    if (allowNoIncoming.has(s.id) || allowNoIncoming.has(key)) continue;
    warnings.push(`⚠️ 遷移元がありません: ${s.id} (${key})`);
  }

  // ---------- L3 parse (actions) ----------
  const l3ActionsByScreen = new Map<string, Set<string>>(); // screenKey -> action ids
  for (const f of l3Files) {
    const doc = readYaml<L3Doc>(f);
    if (!v3(doc)) {
      errors.push(
        `🔴 L3 invalid: ${path.relative(options.specsDir, f)}: ${ajv.errorsText(v3.errors)}`,
      );
      continue;
    }

    const key = screenKey(doc.screen.id, doc.screen.context);
    const set = l3ActionsByScreen.get(key) ?? new Set<string>();

    walkNodes(doc.screen.layout, (n) => {
      if (!n || typeof n !== 'object') return;
      if (typeof n.action === 'string' && n.action.length > 0) set.add(n.action);
    });

    if (set.size) l3ActionsByScreen.set(key, set);
  }

  // ---------- L4 parse (events keys) ----------
  const l4EventsByScreen = new Map<string, Set<string>>(); // screenId -> event keys
  for (const f of l4Files) {
    const doc = readYaml<L4Doc>(f);
    if (!v4(doc)) {
      errors.push(
        `🔴 L4 invalid: ${path.relative(options.specsDir, f)}: ${ajv.errorsText(v4.errors)}`,
      );
      continue;
    }
    const sid = doc.screen.id;
    const ev = doc.screen.events ?? {};
    l4EventsByScreen.set(sid, new Set(Object.keys(ev)));
  }

  // ==========================
  // Cross-layer validation
  // ==========================

  // (1) L3.action must exist in L2 transition.id (same screen)
  for (const [sKey, actions] of l3ActionsByScreen.entries()) {
    const allowed = l2TransitionsByScreen.get(sKey) ?? new Set<string>();
    if (!l2TransitionsByScreen.has(sKey)) {
      errors.push(`🔴 L3 screen not found in L2: ${sKey}`);
      continue;
    }
    for (const a of actions) {
      if (!allowed.has(a)) {
        errors.push(`🔴 L3 action not declared in L2 transitions: ${sKey} -> ${a}`);
      }
    }
  }

  // (2) L4.events key must exist in L2 transition.id (same screen id)
  for (const [sid, evKeys] of l4EventsByScreen.entries()) {
    const sKey = sid; // context未使用の前提（必要ならここで key化）
    const allowed = l2TransitionsByScreen.get(sKey) ?? new Set<string>();
    if (!l2TransitionsByScreen.has(sKey)) {
      errors.push(`🔴 L4 screen not found in L2: ${sid}`);
      continue;
    }
    for (const k of evKeys) {
      if (!allowed.has(k)) {
        errors.push(`🔴 L4 event key not declared in L2 transitions: ${sid} -> ${k}`);
      }
    }
  }

  // (3) L2 transition.id unused => warning
  for (const [sKey, ids] of l2TransitionsByScreen.entries()) {
    const usedByL3 = l3ActionsByScreen.get(sKey) ?? new Set<string>();
    const usedByL4 = l4EventsByScreen.get(sKey) ?? new Set<string>();
    for (const id of ids) {
      if (!usedByL3.has(id) && !usedByL4.has(id)) {
        warnings.push(`⚠️ 未参照の遷移: ${sKey} -> ${id}（L3.action / L4.events に出てこない）`);
      }
    }
  }

  return { errors, warnings };
}
