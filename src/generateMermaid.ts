import fg from 'fast-glob';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

type Options = { specsDir: string; schemaDir: string };
type L2 = {
  screen: {
    id: string;
    name: string;
    type: 'screen' | 'choice';
    context?: string;
    transitions: Array<{
      id: string;
      trigger: 'tap' | 'auto';
      target: string;
      targetContext?: string;
      guard?: string;
      else?: boolean;
    }>;
  };
};

function loadConfig(specsDir: string): Record<string, unknown> {
  const p = path.join(specsDir, 'mobilespec.config.yml');
  if (!fs.existsSync(p)) return { mermaid: { groupOrder: [] } };
  return yaml.load(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
}

export async function generateMermaid(options: Options): Promise<void> {
  const cfg = loadConfig(options.specsDir);
  const paths =
    cfg.paths && typeof cfg.paths === 'object' && cfg.paths !== null
      ? (cfg.paths as Record<string, unknown>)
      : {};
  const L2_DIR = path.join(
    options.specsDir,
    typeof paths.l2 === 'string' ? paths.l2 : 'L2.screenflows'
  );

  const files = fg.sync(['**/*.flow.yaml'], { cwd: L2_DIR, absolute: true });
  const screens: Array<{
    id: string;
    name: string;
    type: L2['screen']['type'];
    group: string;
    transitions: L2['screen']['transitions'];
  }> = [];

  for (const f of files) {
    const doc = yaml.load(fs.readFileSync(f, 'utf8')) as L2;
    const rel = path.relative(L2_DIR, f);
    const group = rel.split(path.sep)[0] ?? 'misc';
    screens.push({
      id: doc.screen.id,
      name: doc.screen.name,
      type: doc.screen.type,
      group,
      transitions: doc.screen.transitions,
    });
  }

  const order: string[] =
    cfg.mermaid && typeof cfg.mermaid === 'object' && cfg.mermaid !== null
      ? (((cfg.mermaid as Record<string, unknown>).groupOrder as string[]) ?? [])
      : [];
  const groups = new Map<string, typeof screens>();
  for (const s of screens) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group)!.push(s);
  }

  const sortedGroupKeys = [
    ...order.filter((g) => groups.has(g)),
    ...[...groups.keys()].filter((g) => !order.includes(g)).sort(),
  ];

  let out = '';
  out += '<!-- AUTO-GENERATED. DO NOT EDIT. -->\n';
  out += '```mermaid\n';
  out += 'flowchart TD\n\n';

  for (const g of sortedGroupKeys) {
    out += `subgraph ${g}\n`;
    for (const s of groups.get(g)!) {
      // Mermaid node shapes
      // - screen: rectangle
      // - choice: decision (diamond-ish) via curly braces
      if (s.type === 'choice') {
        out += `  ${s.id}{"${s.id}\\n${s.name}"}\n`;
      } else {
        out += `  ${s.id}["${s.id}\\n${s.name}"]\n`;
      }
    }
    out += 'end\n\n';
  }

  for (const s of screens) {
    for (const t of s.transitions) {
      const parts: string[] = [];
      parts.push(`${t.id}/${t.trigger}`);
      if (typeof t.guard === 'string' && t.guard.trim() !== '') {
        parts.push(`[${t.guard.trim()}]`);
      }
      if (t.else === true) {
        parts.push('[else]');
      }
      out += `${s.id} -->|${parts.join(' ')}| ${t.target}\n`;
    }
  }

  out += '```\n';

  const dest = path.join(options.specsDir, 'flows.md');
  fs.writeFileSync(dest, out, 'utf8');
}
