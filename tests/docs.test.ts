// tests/docs.test.ts — 人間向けドキュメントと JSON の出力
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { exportModel, renderDocs } from '../src/commands/docs.js';
import { validate } from '../src/validate.js';
import { makeProject } from './helpers/okProject.js';

const schemaDir = path.resolve(process.cwd(), 'schema');

describe('docs / export', () => {
  it('画面ごとの Markdown と索引を、決定的に出す', () => {
    const r = validate({ specsDir: makeProject(), schemaDir });
    const a = renderDocs(r.project, r.edges, r.openapi);
    const b = renderDocs(r.project, r.edges, r.openapi);
    expect([...a.entries()]).toEqual([...b.entries()]);
    const index = a.get('index.md')!;
    expect(index).toContain('```mermaid');
    for (const id of r.project.screens.keys()) {
      expect(a.has(`screens/${id}.md`)).toBe(true);
      expect(index).toContain(`screens/${id}.md`);
    }
  });

  it('export は全画面と遷移を JSON で返す', () => {
    const r = validate({ specsDir: makeProject(), schemaDir });
    const m = exportModel(r.project, r.edges, r.openapi) as {
      version: number;
      screens: unknown[];
      edges: unknown[];
    };
    expect(m.version).toBe(2);
    expect(m.screens.length).toBe(r.project.screens.size);
    expect(m.edges.length).toBe(r.edges.length);
    expect(() => JSON.stringify(m)).not.toThrow();
  });
});
