// scripts/generateI18n.ts
import fg from 'fast-glob';
import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';

/**
 * i18n key rules (v1)
 * - L2 screen.name => app.screen.<screenId>[.ctx.<context>].title
 * - L3 node.name   => app.screen.<screenId>[.ctx.<context>].component.<nodeId>.label
 *
 * strict:
 * - L2 screen.id must exist and be valid
 * - L3: every visited node MUST have id (even containers). If not, throw with file + path info.
 * - If a node has name, id must exist (covered by above)
 */

type Options = { specsDir: string; schemaDir: string };

type Config = {
  paths?: { l2?: string; l3?: string; l4?: string };
  i18n?: { locales?: string[] };
};

type L2Flow = {
  screen?: {
    id?: unknown;
    context?: unknown;
    name?: unknown;
    type?: unknown;
    entry?: unknown;
    exit?: unknown;
    transitions?: unknown;
  };
};

type L3Ui = {
  screen?: {
    id?: unknown;
    context?: unknown;
    layout?: unknown;
  };
};

type JsonMap = Record<string, string>;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function readYamlFile<T>(absPath: string): T {
  const text = fs.readFileSync(absPath, 'utf8');
  return yaml.load(text) as T;
}

function readConfig(specsDir: string): Config {
  const cfgPath = path.join(specsDir, 'mobilespec.config.yml');
  if (!fs.existsSync(cfgPath)) return {};
  return yaml.load(fs.readFileSync(cfgPath, 'utf8')) as Config;
}

/**
 * We enforce IDs to be stable + safe as key segments.
 * If you need broader characters, loosen here (but keep deterministic mapping).
 */
const ID_RE = /^[a-z0-9_]+$/;

function assertIdLike(value: unknown, label: string, filePath: string, hintPath: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`[i18n] missing ${label} at ${hintPath} in ${filePath}`);
  }
  if (!ID_RE.test(value)) {
    throw new Error(
      `[i18n] invalid ${label}="${value}" (allowed: ${ID_RE}) at ${hintPath} in ${filePath}`
    );
  }
  return value;
}

function getContext(value: unknown, filePath: string, hintPath: string): string | undefined {
  if (value == null) return undefined;
  const ctx = assertIdLike(value, 'context', filePath, hintPath);
  return ctx;
}

function screenPrefix(screenId: string, context?: string): string {
  // app.screen.<screenId>[.ctx.<context>]
  return context ? `app.screen.${screenId}.ctx.${context}` : `app.screen.${screenId}`;
}

// function sortedKeys<T extends Record<string, unknown>>(obj: T): (keyof T)[] {
//   return Object.keys(obj).sort((a, b) => a.localeCompare(b)) as (keyof T)[];
// }

function readJsonIfExists(absPath: string): JsonMap {
  if (!fs.existsSync(absPath)) return {};
  const txt = fs.readFileSync(absPath, 'utf8').trim();
  if (!txt) return {};
  return JSON.parse(txt) as JsonMap;
}

function writeJsonStable(absPath: string, obj: JsonMap) {
  const sorted: JsonMap = {};
  for (const k of Object.keys(obj).sort((a, b) => a.localeCompare(b))) {
    sorted[k] = obj[k];
  }
  fs.writeFileSync(absPath, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

type WalkItem = { node: Record<string, unknown>; nodePath: string };

function collectChildren(node: Record<string, unknown>, basePath: string): WalkItem[] {
  const out: WalkItem[] = [];

  // node.children[]
  if (Array.isArray(node.children)) {
    node.children.forEach((c, i) => {
      if (isObj(c)) out.push({ node: c, nodePath: `${basePath}.children[${i}]` });
    });
  }

  // node.layout.children[]
  if (isObj(node.layout) && Array.isArray((node.layout as Record<string, unknown>).children)) {
    const layout = node.layout as Record<string, unknown>;
    (layout.children as unknown[]).forEach((c, i) => {
      if (isObj(c)) out.push({ node: c, nodePath: `${basePath}.layout.children[${i}]` });
    });
  }

  return out;
}

/**
 * Strict walk:
 * - every visited node must have id (string + pattern)
 */
function walkStrict(
  root: Record<string, unknown>,
  filePath: string,
  visit: (node: Record<string, unknown>, nodePath: string, nodeId: string) => void
) {
  const stack: WalkItem[] = [{ node: root, nodePath: 'screen.layout' }];

  while (stack.length > 0) {
    const cur = stack.pop()!;
    const node = cur.node;
    const nodePath = cur.nodePath;

    // root(layout) だけ id チェックをスキップ
    const isRoot = nodePath === 'screen.layout';

    let nodeId = '';
    if (!isRoot) {
      nodeId = assertIdLike(node.id, 'node.id', filePath, nodePath);
      visit(node, nodePath, nodeId);
    }

    const children = collectChildren(node, nodePath);
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push(children[i]);
    }
  }
}

export async function generateI18n(options: Options): Promise<void> {
  const cfg = readConfig(options.specsDir);
  const pathsCfg = cfg.paths ?? {};

  const L2_DIR = path.join(
    options.specsDir,
    typeof pathsCfg.l2 === 'string' ? pathsCfg.l2 : 'L2.screenflows'
  );
  const L3_DIR = path.join(
    options.specsDir,
    typeof pathsCfg.l3 === 'string' ? pathsCfg.l3 : 'L3.ui'
  );

  // Locales: ja is source. Others are targets.
  const locales =
    Array.isArray(cfg.i18n?.locales) && cfg.i18n!.locales.length > 0
      ? cfg.i18n!.locales
      : ['ja', 'en', 'zh-Hans', 'ko']; // default; change in mobilespec.config.yml

  if (!locales.includes('ja')) {
    throw new Error('[i18n] locales must include "ja" as source locale');
  }

  const outDir = path.join(options.specsDir, 'i18n');
  fs.mkdirSync(outDir, { recursive: true });

  // Load existing dictionaries (preserve translations)
  const dictByLocale = new Map<string, JsonMap>();
  for (const loc of locales) {
    const p = path.join(outDir, `${loc}.json`);
    dictByLocale.set(loc, readJsonIfExists(p));
  }

  const ja = dictByLocale.get('ja') ?? {};
  const usedKeys = new Set<string>();

  // ----------------
  // L2: screen.title
  // ----------------
  const l2Files = fg.sync(['**/*.flow.yaml'], { cwd: L2_DIR, absolute: true });
  for (const f of l2Files) {
    const doc = readYamlFile<L2Flow>(f);
    const screen = doc.screen;
    if (!screen) continue;

    const screenId = assertIdLike(screen.id, 'screen.id', f, 'screen.id');
    const context = getContext(screen.context, f, 'screen.context');
    const name = screen.name;

    if (typeof name === 'string' && name.length > 0) {
      const key = `${screenPrefix(screenId, context)}.title`;
      ja[key] = name;
      usedKeys.add(key);
    }
  }

  // -------------------------
  // L3: component.<id>.label
  // -------------------------
  const l3Files = fg.sync(['**/*.ui.yaml'], { cwd: L3_DIR, absolute: true });
  for (const f of l3Files) {
    const doc = readYamlFile<L3Ui>(f);
    const screen = doc.screen;
    if (!screen) {
      throw new Error(`[i18n] missing screen in ${f}`);
    }

    const screenId = assertIdLike(screen.id, 'screen.id', f, 'screen.id');
    const context = getContext(screen.context, f, 'screen.context');

    if (!isObj(screen.layout)) {
      throw new Error(`[i18n] missing screen.layout in ${f}`);
    }

    // Strict: every node in layout tree must have id
    walkStrict(screen.layout as Record<string, unknown>, f, (node, _nodePath, nodeId) => {
      const name = node.name;
      if (typeof name === 'string' && name.length > 0) {
        const key = `${screenPrefix(screenId, context)}.component.${nodeId}.label`;
        ja[key] = name;
        usedKeys.add(key);
      }
    });
  }

  // Write back ja
  dictByLocale.set('ja', ja);

  // For non-ja locales: add missing keys with ""
  for (const loc of locales) {
    if (loc === 'ja') continue;
    const m = dictByLocale.get(loc) ?? {};
    for (const k of usedKeys) {
      if (!(k in m)) m[k] = '';
    }
    dictByLocale.set(loc, m);
  }

  // Optional: prune keys that are not used anymore (disabled by default to avoid losing translations)
  // If you want pruning, do it in validate as warnings, and add a separate "prune" command.

  // Save
  for (const loc of locales) {
    const p = path.join(outDir, `${loc}.json`);
    writeJsonStable(p, dictByLocale.get(loc) ?? {});
  }
}

/**
 * mobilespec.config.yml example:
 *
 * paths:
 *   l2: L2.screenflows
 *   l3: L3.ui
 * i18n:
 *   locales:
 *     - ja
 *     - en
 *     - zh-Hans
 *     - ko
 */
