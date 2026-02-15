import fs from 'fs';
import { createRequire } from 'node:module';
import type { YamlFile } from './io.js';

const require = createRequire(import.meta.url);
const Ajv = (require('ajv/dist/2020') as any).default ?? require('ajv/dist/2020');

/* ================================
 * Schema Validation
 * ================================ */

export function validateSchema(files: YamlFile[], schemaPath: string, label: string): string[] {
  const errors: string[] = [];

  if (!fs.existsSync(schemaPath)) {
    errors.push(`❌ スキーマファイルが見つかりません: ${schemaPath}`);
    return errors;
  }

  const schemaData = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schemaData);

  for (const file of files) {
    const valid = validate(file.data);
    if (!valid && validate.errors) {
      for (const err of validate.errors) {
        const p = err.instancePath || '/';
        const message = err.message || 'unknown error';
        errors.push(`❌ ${label} スキーマエラー (${file.path}): ${p} ${message}`);
      }
    }
  }

  return errors;
}
