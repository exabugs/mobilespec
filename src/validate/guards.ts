// src/validate/guards.ts
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export type GuardDef = {
  id: string;
  name?: string;
  description?: string;
};

/**
 * Load L2 guard definitions (SSOT).
 *
 * File: <specsDir>/L2.guards.yaml
 *
 * Accepts either:
 *   - { guards: [{ id, name?, description? }, ...] }
 *   - [ { id, ... }, ... ]
 *   - [ "guardId", ... ]
 */
export function loadL2Guards(specsDir: string): { defs: GuardDef[]; ids: Set<string> } {
  const p = path.join(specsDir, 'L2.guards.yaml');
  if (!fs.existsSync(p)) return { defs: [], ids: new Set() };

  const raw = yaml.load(fs.readFileSync(p, 'utf-8'));
  const defs: GuardDef[] = [];

  const pushId = (id: unknown) => {
    if (typeof id !== 'string') return;
    const tid = id.trim();
    if (!tid) return;
    defs.push({ id: tid });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        pushId(item);
      } else if (item && typeof item === 'object' && !Array.isArray(item)) {
        const r = item as Record<string, unknown>;
        if (typeof r.id === 'string' && r.id.trim()) {
          defs.push({
            id: r.id.trim(),
            name: typeof r.name === 'string' ? r.name : undefined,
            description: typeof r.description === 'string' ? r.description : undefined,
          });
        }
      }
    }
  } else if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const g = r.guards;
    if (Array.isArray(g)) {
      for (const item of g) {
        if (typeof item === 'string') {
          pushId(item);
        } else if (item && typeof item === 'object' && !Array.isArray(item)) {
          const rr = item as Record<string, unknown>;
          if (typeof rr.id === 'string' && rr.id.trim()) {
            defs.push({
              id: rr.id.trim(),
              name: typeof rr.name === 'string' ? rr.name : undefined,
              description: typeof rr.description === 'string' ? rr.description : undefined,
            });
          }
        }
      }
    }
  }

  const ids = new Set<string>();
  for (const d of defs) ids.add(d.id);
  return { defs, ids };
}
