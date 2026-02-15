import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';
import yaml from 'js-yaml';

type Options = { specsDir: string; schemaDir: string };
type L3 = { screen: { id: string; context?: string; layout: Record<string, unknown> } };

function walk(node: Record<string, unknown>, visit: (n: Record<string, unknown>) => void) {
  if (!node) return;
  visit(node);
  if (Array.isArray(node.children)) for (const c of node.children) walk(c, visit);
  if (node.layout && typeof node.layout === 'object' && node.layout !== null) {
    const layout = node.layout as Record<string, unknown>;
    if (Array.isArray(layout.children)) {
      for (const c of layout.children) walk(c, visit);
    }
  }
}

export async function generateI18n(options: Options): Promise<void> {
  const cfgPath = path.join(options.specsDir, 'mobilespec.config.yml');
  const cfg = fs.existsSync(cfgPath) ? (yaml.load(fs.readFileSync(cfgPath, 'utf8')) as Record<string, unknown>) : {};
  const paths = cfg.paths && typeof cfg.paths === 'object' && cfg.paths !== null ? cfg.paths as Record<string, unknown> : {};
  const L3_DIR = path.join(options.specsDir, typeof paths.l3 === 'string' ? paths.l3 : 'L3.ui');

  const files = fg.sync(['**/*.ui.yaml'], { cwd: L3_DIR, absolute: true });
  if (files.length === 0) {
    console.warn('⚠️ YAML ファイルが見つかりません');
    return;
  }

  const ja: Record<string, string> = {};
  const en: Record<string, string> = {};

  for (const f of files) {
    const doc = yaml.load(fs.readFileSync(f, 'utf8')) as L3;
    const screenId = doc.screen.id;

    // screen title（あれば）
    // L3 schema は screen.name を必須にしていないので、ノード name を中心に収集

    walk(doc.screen.layout, (n) => {
      if (typeof n.id === 'string' && typeof n.name === 'string') {
        const key = `ui.${screenId}.${n.id}`;
        ja[key] = n.name;
        if (!(key in en)) en[key] = '';
      }
    });
  }

  const outDir = path.join(options.specsDir, 'i18n');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'ja.json'), JSON.stringify(ja, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'en.json'), JSON.stringify(en, null, 2) + '\n', 'utf8');
}
