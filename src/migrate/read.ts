// src/migrate/read.ts — 旧体系（L2.screenflows / L3.ui / L4.state / L2.guards.yaml / mobilespec.config.yml）の読み込み
import fg from 'fast-glob';
import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';

import { type Doc, asArray, isObj } from '../core/model.js';

export type OldFile = {
  /** specs ディレクトリからの相対パス */
  rel: string;
  /** screen の中身（旧書式は `screen:` で包まれている。別書式は最上位） */
  body: Doc;
  /** 元のファイルの全文 */
  text: string;
};

export type OldScreen = {
  id: string;
  /** L2 のディレクトリの最初の階層 */
  group?: string;
  l2?: OldFile;
  l3?: OldFile;
  l4?: OldFile;
};

export type OldProject = {
  dir: string;
  config: Doc;
  guards: Array<{ id: string; name?: string; description?: string }>;
  screens: Map<string, OldScreen>;
  /** 読み込めなかったファイル */
  problems: string[];
  /** そのまま移すファイル（相対パス） */
  passthrough: string[];
};

function readYaml(
  dir: string,
  rel: string,
  problems: string[]
): { data: unknown; text: string } | undefined {
  try {
    const text = fs.readFileSync(path.join(dir, rel), 'utf8');
    return { data: yaml.load(text), text };
  } catch (e) {
    problems.push(`${rel}: ${String((e as Error).message).split('\n')[0]}`);
    return undefined;
  }
}

/** 旧書式（`screen:` の包み）と、別書式（`screen: <id>` の文字列 + 最上位にその画面の中身）の両方を読む */
function bodyOf(data: unknown): { id?: string; body: Doc } | undefined {
  if (!isObj(data)) return undefined;
  const screen = data.screen;
  if (isObj(screen)) {
    return { id: typeof screen.id === 'string' ? screen.id : undefined, body: screen };
  }
  if (typeof screen === 'string') {
    const { screen: _omit, ...rest } = data;
    void _omit;
    return { id: screen, body: rest };
  }
  return undefined;
}

export function readOldProject(dir: string): OldProject {
  const problems: string[] = [];
  const screens = new Map<string, OldScreen>();

  const config = (() => {
    const r = readYaml(dir, 'mobilespec.config.yml', problems);
    return isObj(r?.data) ? (r!.data as Doc) : {};
  })();
  const guardsDoc = fs.existsSync(path.join(dir, 'L2.guards.yaml'))
    ? readYaml(dir, 'L2.guards.yaml', problems)
    : undefined;
  const guards = isObj(guardsDoc?.data)
    ? asArray((guardsDoc!.data as Doc).guards)
        .filter(isObj)
        .filter((g) => typeof g.id === 'string')
        .map((g) => ({
          id: String(g.id),
          ...(typeof g.name === 'string' && { name: g.name }),
          ...(typeof g.description === 'string' && { description: g.description }),
        }))
    : [];

  const layers = [
    { key: 'l2', dir: 'L2.screenflows', ext: '.flow.yaml' },
    { key: 'l3', dir: 'L3.ui', ext: '.ui.yaml' },
    { key: 'l4', dir: 'L4.state', ext: '.state.yaml' },
  ] as const;
  for (const layer of layers) {
    const base = path.join(dir, layer.dir);
    if (!fs.existsSync(base)) continue;
    for (const f of fg.sync([`**/*${layer.ext}`], { cwd: base }).sort()) {
      const rel = path.posix.join(layer.dir, f);
      const r = readYaml(dir, rel, problems);
      if (!r) continue;
      const parsed = bodyOf(r.data);
      const id = parsed?.id ?? path.posix.basename(f, layer.ext);
      if (!parsed) {
        problems.push(`${rel}: 旧書式（screen:）として読めません`);
        continue;
      }
      const s: OldScreen = screens.get(id) ?? { id };
      s[layer.key] = { rel, body: parsed.body, text: r.text };
      if (layer.key === 'l2') {
        const parts = f.split('/');
        if (parts.length > 1) s.group = parts[0];
      }
      screens.set(id, s);
    }
  }

  const passthrough: string[] = [];
  for (const f of ['design-tokens.yaml']) if (fs.existsSync(path.join(dir, f))) passthrough.push(f);
  const i18nDir = path.join(dir, 'i18n');
  if (fs.existsSync(i18nDir)) {
    for (const f of fs.readdirSync(i18nDir).sort()) {
      if (f.endsWith('.json') && f !== 'ja.json') passthrough.push(`i18n/${f}`);
    }
  }
  return { dir, config, guards, screens, problems, passthrough };
}

/** ファイル内のコメントを集める（変換でコメントが失われても、情報を失わないため）。yaml-language-server 行は除く */
export function extractComments(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || /^#\s*yaml-language-server/i.test(line)) continue;
    if (line.startsWith('#')) {
      const c = line.replace(/^#+\s*/, '').trim();
      if (c) out.push(c);
      continue;
    }
    // 行末のコメント（引用符の外の ` #`）
    let quote = '';
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === "'" || ch === '"') {
        quote = ch;
      } else if (ch === '#' && i > 0 && /\s/.test(raw[i - 1])) {
        const c = raw.slice(i + 1).trim();
        if (c) out.push(c);
        break;
      }
    }
  }
  return out;
}
