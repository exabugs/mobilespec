import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

/* ================================
 * Load YAML Files
 * ================================ */

export type YamlFile = {
  path: string;
  data: Record<string, unknown>;
  group: string; // ディレクトリ構造から決定されるグループ
};

export function loadYamlFiles(dir: string, extension: string): YamlFile[] {
  const results: YamlFile[] = [];

  function traverse(currentDir: string, relativePath: string = '') {
    if (!fs.existsSync(currentDir)) return;

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      const newRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        traverse(fullPath, newRelativePath);
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        const data = yaml.load(fs.readFileSync(fullPath, 'utf-8')) as Record<string, unknown>;

        // ディレクトリ構造からグループを決定
        // screenflows/ 直下のファイル → グループなし ('')
        // screenflows/home/xxx.yaml → 'Home'
        // screenflows/venue/nearby/xxx.yaml → 'Venue/Nearby'
        const dirPath = path.dirname(newRelativePath);
        const group =
          dirPath === '.'
            ? ''
            : dirPath
                .split(path.sep)
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join('/');

        results.push({ path: fullPath, data, group });
      }
    }
  }

  traverse(dir);
  return results;
}
