// src/validate/config.ts
import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';

import type { MobileSpecConfig } from './types.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const arr = v.filter((x) => typeof x === 'string') as string[];
  return arr.length ? arr : [];
}

export function loadConfig(specsDir: string): MobileSpecConfig {
  const configPath = path.join(specsDir, 'mobilespec.config.yml');

  const defaultConfig: MobileSpecConfig = {
    mermaid: {
      groupOrder: ['Home', 'Task', 'Venue', 'Misc'],
      screenOrder: [],
    },
    i18n: {
      locales: ['ja', 'en'],
    },
    validation: {
      allowNoIncoming: [],
    },
    // openapi は “未設定なら undefined” のまま
  };

  if (!fs.existsSync(configPath)) return defaultConfig;

  try {
    const raw = yaml.load(fs.readFileSync(configPath, 'utf-8'));
    if (!isRecord(raw)) return defaultConfig;

    const mermaid = isRecord(raw.mermaid) ? raw.mermaid : {};
    const i18n = isRecord(raw.i18n) ? raw.i18n : {};
    const validation = isRecord(raw.validation) ? raw.validation : {};
    const openapi = isRecord(raw.openapi) ? raw.openapi : undefined;

    const groupOrder = asStringArray(mermaid.groupOrder) ?? defaultConfig.mermaid.groupOrder;
    const screenOrder = asStringArray(mermaid.screenOrder) ?? defaultConfig.mermaid.screenOrder;

    const locales = asStringArray(i18n.locales) ?? defaultConfig.i18n?.locales;

    const allowNoIncoming =
      asStringArray(validation.allowNoIncoming) ?? defaultConfig.validation?.allowNoIncoming;

    const openapiPath =
      openapi && typeof openapi.path === 'string' ? openapi.path.trim() : undefined;
    const warnUnusedOperationId =
      openapi && typeof openapi.warnUnusedOperationId === 'boolean'
        ? openapi.warnUnusedOperationId
        : true;

    const checkSelectRoot =
      openapi && typeof openapi.checkSelectRoot === 'boolean' ? openapi.checkSelectRoot : false;

    return {
      mermaid: { groupOrder, screenOrder },
      i18n: { locales },
      validation: { allowNoIncoming },
      openapi: openapiPath
        ? {
            path: openapiPath,
            warnUnusedOperationId,
            checkSelectRoot,
          }
        : undefined,
    };
  } catch {
    console.warn(`⚠️ 設定ファイルの読み込みに失敗しました: ${configPath}`);
    return defaultConfig;
  }
}
