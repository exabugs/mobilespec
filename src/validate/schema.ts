import fs from 'fs';
import { createRequire } from 'node:module';

import type { Diagnostic } from '../types/diagnostic.js';
import { schemaError, schemaNotFound } from './diagnostics.js';
import type { YamlFile } from './io.js';

const require = createRequire(import.meta.url);
const AjvClass =
  (require('ajv/dist/2020') as { default?: unknown }).default ?? require('ajv/dist/2020');

type AjvInstance = {
  compile: (schema: Record<string, unknown>) => {
    (data: unknown): boolean;
    errors?: Array<{ instancePath?: string; message?: string }> | null;
  };
};

/* ================================
 * Schema Validation
 * ================================ */

export function validateSchema(
  files: YamlFile[],
  schemaPath: string,
  label: 'L2' | 'L3' | 'L4'
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!fs.existsSync(schemaPath)) {
    diagnostics.push(schemaNotFound(label, schemaPath));
    return diagnostics;
  }

  const schemaData = JSON.parse(fs.readFileSync(schemaPath, 'utf-8')) as Record<string, unknown>;
  const ajv = new (AjvClass as new (options: {
    strict: boolean;
    allErrors: boolean;
  }) => AjvInstance)({
    strict: false,
    allErrors: true,
  });
  const validate = ajv.compile(schemaData);

  for (const file of files) {
    const valid = validate(file.data);
    if (!valid && validate.errors) {
      for (const err of validate.errors) {
        const p = err.instancePath || '/';
        const message = err.message || 'unknown error';
        diagnostics.push(schemaError(label, file.path, p, message));
      }
    }
  }

  return diagnostics;
}
