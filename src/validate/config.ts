import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

import type { MobileSpecConfig } from './types.js';

/* ================================
 * Load Config
 * ================================ */

export function loadConfig(specsDir: string): MobileSpecConfig {
  const configPath = path.join(specsDir, 'mobilespec.config.yml');

  // デフォルト設定
  const defaultConfig: MobileSpecConfig = {
    mermaid: {
      groupOrder: ['Home', 'Task', 'Venue', 'Misc'],
      screenOrder: [],
    },
  };

  if (!fs.existsSync(configPath)) {
    return defaultConfig;
  }

  try {
    const configData = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const mermaid =
      configData.mermaid && typeof configData.mermaid === 'object' && configData.mermaid !== null
        ? (configData.mermaid as Record<string, unknown>)
        : {};
    return {
      mermaid: {
        groupOrder: Array.isArray(mermaid.groupOrder)
          ? mermaid.groupOrder
          : defaultConfig.mermaid.groupOrder,
        screenOrder: Array.isArray(mermaid.screenOrder)
          ? mermaid.screenOrder
          : defaultConfig.mermaid.screenOrder,
      },
    };
  } catch {
    console.warn(`⚠️  設定ファイルの読み込みに失敗しました: ${configPath}`);
    return defaultConfig;
  }
}
