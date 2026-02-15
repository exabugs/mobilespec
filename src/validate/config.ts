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
    const configData = yaml.load(fs.readFileSync(configPath, 'utf-8')) as any;
    return {
      mermaid: {
        groupOrder: configData.mermaid?.groupOrder || defaultConfig.mermaid.groupOrder,
        screenOrder: configData.mermaid?.screenOrder || defaultConfig.mermaid.screenOrder,
      },
    };
  } catch {
    console.warn(`⚠️  設定ファイルの読み込みに失敗しました: ${configPath}`);
    return defaultConfig;
  }
}
