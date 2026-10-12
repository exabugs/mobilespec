// src/index.ts — ライブラリとしての公開 API
export { validate } from './validate.js';
export type { ValidateOptions, ValidationResult } from './validate.js';
export { buildReport, toJson } from './report.js';
export type { Diagnostic, DiagnosticCode, DiagnosticLevel } from './core/diagnostic.js';
export { errorsOf, infosOf } from './core/diagnostic.js';
export { loadProject } from './core/load.js';
export type { Project, ScreenFiles } from './core/model.js';
export { buildGraph, expectedJa } from './core/derive.js';
export { parseExpr, parseReference } from './core/expr.js';
export { buildContext, renderContext } from './commands/context.js';
export { runUpdate } from './commands/update.js';
export { runNew } from './commands/new.js';
