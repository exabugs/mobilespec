// src/rules/text.ts — 人向けの説明と、文字列の検査（すべて info。実装不能ではない）
import fs from 'node:fs';
import path from 'node:path';

import { type Diagnostic } from '../core/diagnostic.js';
import { type Doc, type Project, asArray, asObj, isObj } from '../core/model.js';

const HTTP_IN_TEXT = /\b(GET|POST|PUT|PATCH|DELETE)\s+\/[\w./{}:-]*/;

function walkStrings(v: unknown, pointer: string, cb: (s: string, pointer: string) => void): void {
  if (typeof v === 'string') cb(v, pointer);
  else if (Array.isArray(v)) v.forEach((x, i) => walkStrings(x, `${pointer}/${i}`, cb));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) walkStrings(x, `${pointer}/${k}`, cb);
}

const blank = (v: unknown): boolean => typeof v !== 'string' || v.trim() === '';

export function checkText(project: Project): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const s of project.screens.values()) {
    for (const f of [s.l2, s.l3, s.l4]) {
      if (!f) continue;
      // HTTP のメソッドとパスは、仕様に書かない（OpenAPI の operationId で参照する）
      const hits: string[] = [];
      walkStrings(f.data, '', (str, pointer) => {
        if (HTTP_IN_TEXT.test(str)) hits.push(pointer);
      });
      if (hits.length > 0) {
        out.push({
          code: 'HTTP_IN_TEXT',
          level: 'info',
          file: f.file,
          pointer: hits[0],
          message: `HTTP のメソッドとパスが文字列に書かれています（${hits.length} 件）。URL・HTTP メソッドは仕様に書かず、L4 の data（operationId）で OpenAPI に接続してください`,
          meta: { pointers: hits },
        });
      }
    }

    // 画面の説明（ドキュメントの「未記入」）
    if (s.l2) {
      const missing: string[] = [];
      const d = s.l2.data;
      if (blank(d.summary)) missing.push('summary');
      if (blank(d.description)) missing.push('description');
      asArray(d.params).forEach(
        (p, i) => isObj(p) && blank(p.description) && missing.push(`params/${i}`)
      );
      if (s.l4) {
        const l4 = s.l4.data;
        const named = (map: unknown, base: string) => {
          for (const [k, v] of Object.entries(asObj(map))) {
            if (isObj(v) && blank((v as Doc).description)) missing.push(`${base}/${k}`);
          }
        };
        asArray(l4.state).forEach(
          (st, i) => isObj(st) && blank(st.description) && missing.push(`state/${i}`)
        );
        named(l4.conditions, 'conditions');
        named(l4.sources, 'sources');
        named(l4.events, 'events');
      }
      if (missing.length > 0) {
        out.push({
          code: 'MISSING_DESCRIPTION',
          level: 'info',
          file: s.l2.file,
          message: `説明が未記入の項目が ${missing.length} 件あります（ドキュメントに「未記入」と出ます）`,
          meta: { count: missing.length, items: missing },
        });
      }

      // mockup / links の相対パス
      const dir = path.dirname(path.join(project.specsDir, s.l2.file));
      if (typeof d.mockup === 'string' && !fs.existsSync(path.resolve(dir, d.mockup))) {
        out.push({
          code: 'MISSING_FILE',
          level: 'info',
          file: s.l2.file,
          pointer: '/mockup',
          message: `mockup のファイルが存在しません: ${d.mockup}`,
        });
      }
      asArray(d.links).forEach((l, i) => {
        if (!isObj(l) || typeof l.href !== 'string') return;
        if (/^[a-z]+:|^#/i.test(l.href)) return;
        const target = l.href.split('#')[0];
        if (target && !fs.existsSync(path.resolve(dir, target))) {
          out.push({
            code: 'MISSING_FILE',
            level: 'info',
            file: s.l2!.file,
            pointer: `/links/${i}/href`,
            message: `links のファイルが存在しません: ${l.href}`,
          });
        }
      });
    }
  }
  return out;
}
