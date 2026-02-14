import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';

export type ValidateOptions = { specsDir: string; schemaDir: string };
export type ValidationResult = { errors: string[]; warnings: string[] };

type L2 = {
  screen: {
    id: string;
    context?: string;
    entry?: boolean;
    exit?: boolean;
    transitions: Array<{
      id: string;
      trigger: 'tap' | 'auto';
      target: string;
      targetContext?: string;
    }>;
  };
};
type L3 = { screen: { id: string; context?: string; layout: any } };
type L4 = { screen: { id: string } };

type Config = {
  paths?: { l2?: string; l3?: string; l4?: string };
  mermaid: { groupOrder: string[]; screenOrder?: string[] };
  validation?: { allowNoIncoming?: string[] };
};

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadConfig(specsDir: string): Config {
  const p = path.join(specsDir, 'mobilespec.config.yml');
  if (!fs.existsSync(p)) {
    return { mermaid: { groupOrder: [] }, validation: { allowNoIncoming: [] } };
  }
  const obj = yaml.load(fs.readFileSync(p, 'utf8')) as any;
  return {
    paths: obj.paths ?? {},
    mermaid: obj.mermaid ?? { groupOrder: [] },
    validation: obj.validation ?? { allowNoIncoming: [] },
  };
}

function screenKey(id: string, context?: string) {
  return context ? `${id}__${context}` : id;
}

function parseYaml<T>(filePath: string): T {
  return yaml.load(fs.readFileSync(filePath, 'utf8')) as T;
}

export async function validate(options: ValidateOptions): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const cfg = loadConfig(options.specsDir);
  const L2_DIR = path.join(options.specsDir, cfg.paths?.l2 ?? 'L2.screenflows');
  const L3_DIR = path.join(options.specsDir, cfg.paths?.l3 ?? 'L3.ui');
  const L4_DIR = path.join(options.specsDir, cfg.paths?.l4 ?? 'L4.state');

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
    errors.push(`🔴 mobilespec.config.yml schema invalid: ${ajv.errorsText(vc.errors)}`);
    return { errors, warnings };
  }

  const l2Files = fg.sync(['**/*.flow.yaml'], { cwd: L2_DIR, absolute: true });
  const l3Files = fg.sync(['**/*.ui.yaml'], { cwd: L3_DIR, absolute: true });
  const l4Files = fg.sync(['**/*.state.yaml'], { cwd: L4_DIR, absolute: true });

  if (l2Files.length === 0 && l3Files.length === 0 && l4Files.length === 0) {
    warnings.push('⚠️ YAML ファイルが見つかりません');
    return { errors, warnings };
  }

  const screens = new Map<
    string,
    { id: string; context?: string; entry?: boolean; exit?: boolean }
  >();
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  const transitions = new Set<string>();

  // L2
  for (const f of l2Files) {
    const doc = parseYaml<L2>(f);
    if (!v2(doc)) {
      errors.push(
        `🔴 L2 invalid: ${path.relative(options.specsDir, f)}: ${ajv.errorsText(v2.errors)}`,
      );
      continue;
    }
    const s = doc.screen;
    const key = screenKey(s.id, s.context);
    screens.set(key, { id: s.id, context: s.context, entry: s.entry, exit: s.exit });

    for (const t of s.transitions) {
      transitions.add(t.id);
      outgoing.add(key);
      const toKey = screenKey(t.target, t.targetContext);
      incoming.add(toKey);
    }
  }

  // L3 id整合（存在確認だけ）
  for (const f of l3Files) {
    const doc = parseYaml<L3>(f);
    if (!v3(doc)) {
      errors.push(
        `🔴 L3 invalid: ${path.relative(options.specsDir, f)}: ${ajv.errorsText(v3.errors)}`,
      );
      continue;
    }
    const key = screenKey(doc.screen.id, doc.screen.context);
    if (!screens.has(key)) {
      warnings.push(
        `⚠️ L3 screen が L2 に存在しません: ${key} (${path.relative(options.specsDir, f)})`,
      );
    }
  }

  // L4 id整合（存在確認だけ）
  for (const f of l4Files) {
    const doc = parseYaml<L4>(f);
    if (!v4(doc)) {
      errors.push(
        `🔴 L4 invalid: ${path.relative(options.specsDir, f)}: ${ajv.errorsText(v4.errors)}`,
      );
      continue;
    }
    // L4の id は screen_xxx なので、L2の id と一致させる運用（必要ならここで変換ルールを入れる）
    // ここは “仕様で決める”領域なので、とりあえず warning に止める
    // 例: screen_home -> home
  }

  // 遷移元なし（到達不能）の扱い
  const allow = new Set(cfg.validation?.allowNoIncoming ?? []);
  for (const [key, s] of screens.entries()) {
    if (s.entry) continue;
    if (incoming.has(key)) continue;
    if (allow.has(s.id) || allow.has(key)) continue;
    warnings.push(`⚠️  遷移元がありません: ${s.id} (${key})`);
  }

  return { errors, warnings };
}
