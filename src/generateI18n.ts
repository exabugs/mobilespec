/**
 * i18n Generator
 * Generates i18n JSON files from L2 screenflows and L3 UI specifications
 */

import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import { type ValidateOptions } from './validate.js';

// --- 重要名詞（末尾移動対象） ---
const IMPORTANT_NOUNS = ['venue', 'venues', 'task', 'tasks', 'stamp', 'event'];

/* ================================
 * ユーティリティ
 * ================================ */

function idToEnglishLabel(id: string): string {
  let words = id.split('_');

  // タイププレフィックス除去（先頭の1要素）
  if (words.length > 1) {
    words = words.slice(1);
  }

  // 重要名詞を末尾へ
  for (const n of IMPORTANT_NOUNS) {
    const idx = words.indexOf(n);
    if (idx >= 0 && idx !== words.length - 1) {
      words.splice(idx, 1);
      words.push(n);
    }
  }

  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/* ================================
 * 再帰的に YAML ファイルを収集
 * ================================ */

function findYamlFiles(dir: string, pattern: string, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;
  
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findYamlFiles(fullPath, pattern, results);
    } else if (entry.isFile() && entry.name.endsWith(pattern)) {
      results.push(fullPath);
    }
  }
  return results;
}

/* ================================
 * L2 (screenflows) から収集
 * ================================ */

function collectLabelsFromFlow(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const doc = yaml.load(content) as any;

  const labels: { id: string; ja: string; en: string }[] = [];

  if (!doc.screen) return labels;

  const screenId = doc.screen.id;
  const screenName = doc.screen.name;
  const context = doc.screen.context;

  if (screenId && screenName) {
    const key = context ? `${screenId}_${context}` : `${screenId}`;
    labels.push({
      id: key,
      ja: screenName,
      en: idToEnglishLabel(screenId),
    });
  }

  return labels;
}

/* ================================
 * L3 (ui) から収集
 * ================================ */

function collectLabelsFromUI(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const doc = yaml.load(content) as any;

  const labels: { id: string; ja: string; en: string }[] = [];

  if (!doc.screen || !doc.screen.layout) return labels;

  function traverse(node: any) {
    if (!node) return;

    if (node.id && node.name) {
      labels.push({
        id: node.id,
        ja: node.name,
        en: idToEnglishLabel(node.id),
      });
    }

    // children を再帰
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        traverse(child);
      }
    }

    // layout.children を再帰
    if (node.layout && node.layout.children && Array.isArray(node.layout.children)) {
      for (const child of node.layout.children) {
        traverse(child);
      }
    }
  }

  traverse(doc.screen.layout);

  return labels;
}

/* ================================
 * Main
 * ================================ */

export async function generateI18n(options: ValidateOptions): Promise<void> {
  const FLOW_DIR = path.join(options.specsDir, 'screenflows');
  const UI_DIR = path.join(options.specsDir, 'ui');
  const OUTPUT_JA = path.join(options.specsDir, 'i18n', 'ja.json');
  const OUTPUT_EN = path.join(options.specsDir, 'i18n', 'en.json');

  const flowFiles = findYamlFiles(FLOW_DIR, '.flow.yaml');
  const uiFiles = findYamlFiles(UI_DIR, '.ui.yaml');

  if (flowFiles.length === 0 && uiFiles.length === 0) {
    console.warn('⚠️ YAML ファイルが見つかりません');
    return;
  }

  const jaJson: Record<string, string> = {};
  const enJson: Record<string, string> = {};

  // L2 から収集
  for (const filePath of flowFiles) {
    const labels = collectLabelsFromFlow(filePath);
    for (const l of labels) {
      jaJson[l.id] = l.ja;
      enJson[l.id] = l.en;
    }
  }

  // L3 から収集
  for (const filePath of uiFiles) {
    const labels = collectLabelsFromUI(filePath);
    for (const l of labels) {
      jaJson[l.id] = l.ja;
      enJson[l.id] = l.en;
    }
  }

  // キーでソート
  const jaSorted = Object.fromEntries(
    Object.keys(jaJson)
      .sort()
      .map((k) => [k, jaJson[k]])
  );
  const enSorted = Object.fromEntries(
    Object.keys(enJson)
      .sort()
      .map((k) => [k, enJson[k]])
  );

  // 出力ディレクトリ作成
  const i18nDir = path.dirname(OUTPUT_JA);
  if (!fs.existsSync(i18nDir)) {
    fs.mkdirSync(i18nDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_JA, JSON.stringify(jaSorted, null, 2), 'utf-8');
  fs.writeFileSync(OUTPUT_EN, JSON.stringify(enSorted, null, 2), 'utf-8');

  console.log('✅ i18n JSON を自動生成しました（ja.json / en.json）');
  console.log(`   L2 flows: ${flowFiles.length} files`);
  console.log(`   L3 ui: ${uiFiles.length} files`);
  console.log(`   total keys: ${Object.keys(jaSorted).length}`);
}
