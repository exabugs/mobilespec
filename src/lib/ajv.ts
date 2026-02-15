// src/lib/ajv.ts
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { ValidateFunction } from "ajv";

const require = createRequire(import.meta.url);

// draft 2020-12 用 AJV
const AjvClass =
  (require("ajv/dist/2020") as { default?: unknown }).default ??
  require("ajv/dist/2020");

type AjvInstance = {
  compile: (schema: JsonSchema) => ValidateFunction;
  getSchema: (id: string) => ValidateFunction | undefined;
};

// AJV singleton
let ajvSingleton: AjvInstance | null = null;

// compile 結果のキャッシュ（schemaPath / $id どちらでも引けるようにする）
const compiledByPath = new Map<string, ValidateFunction>();
const compiledById = new Map<string, ValidateFunction>();

export function getAjv(): AjvInstance {
  if (!ajvSingleton) {
    ajvSingleton = new (AjvClass as new (options: {
      strict: boolean;
      allErrors: boolean;
    }) => AjvInstance)({
      strict: false,
      allErrors: true,
    });
  }
  return ajvSingleton;
}

type JsonSchema = { $id?: string } & Record<string, unknown>;

export function compileSchema(schemaPath: string) {
  const abs = path.resolve(schemaPath);

  // 1) path でキャッシュ
  const cached = compiledByPath.get(abs);
  if (cached) return cached;

  if (!fs.existsSync(abs)) {
    throw new Error(`Schema not found: ${abs}`);
  }

  const schema = JSON.parse(fs.readFileSync(abs, "utf-8")) as JsonSchema;
  const ajv = getAjv();

  // 2) $id があるなら、AJV に既に登録済みか確認（ここが今回のバグ回避ポイント）
  const id = schema.$id;
  if (id) {
    const cachedById = compiledById.get(id) ?? ajv.getSchema(id);
    if (cachedById) {
      compiledById.set(id, cachedById);
      compiledByPath.set(abs, cachedById);
      return cachedById;
    }
  }

  // 3) 未登録なら compile（このとき AJV に schema が登録される）
  const validate = ajv.compile(schema);

  compiledByPath.set(abs, validate);
  if (id) compiledById.set(id, validate);

  return validate;
}

export function compileSchemaFromDir(schemaDir: string, filename: string) {
  return compileSchema(path.join(schemaDir, filename));
}
