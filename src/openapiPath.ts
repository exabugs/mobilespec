// src/openapiPath.ts
import fs from 'node:fs';
import path from 'node:path';

/**
 * OpenAPI のパスを解決する。
 * - 絶対パス: そのまま
 * - --openapi の相対パス: カレントディレクトリ基準（Makefile / package.json から、リポジトリのルートで実行する前提）。
 *   後方互換: カレント基準で見つからず、仕様ディレクトリ基準で見つかるときは、そちらを使う
 * - config の openapi.path の相対パス: 仕様ディレクトリ基準
 */
export function resolveOpenapiPath(specsDir: string, raw: string, fromFlag: boolean): string {
  if (path.isAbsolute(raw)) return raw;
  const fromSpecs = path.resolve(specsDir, raw);
  if (!fromFlag) return fromSpecs;
  const fromCwd = path.resolve(process.cwd(), raw);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return fs.existsSync(fromSpecs) ? fromSpecs : fromCwd;
}
