// src/validate/config.ts
import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';

import type { DiagnosticLevel } from '../types/diagnostic.js';
import type { MobileSpecConfig } from './types.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const arr = v.filter((x) => typeof x === 'string') as string[];
  return arr.length ? arr : [];
}

function parseLevelOrOff(v: unknown): DiagnosticLevel | 'off' | undefined {
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'off') return 'off';
    if (s === 'info' || s === 'warning' || s === 'error') return s;
    return undefined;
  }
  if (typeof v === 'boolean') {
    // 後方互換
    return v ? 'warning' : 'off';
  }
  return undefined;
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

    // ★導入期デフォルトは "info"（fail-on-warnings で落ちない）
    const warnUnusedOperationId = openapi
      ? (parseLevelOrOff(openapi.warnUnusedOperationId) ?? 'info')
      : undefined;

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
