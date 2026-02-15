/* ================================
 * Types
 * ================================ */

export type MobileSpecConfig = {
  mermaid: {
    groupOrder: string[];
    screenOrder?: string[];
  };
};

export type Screen = {
  id: string;
  name: string;
  group: string;
  order?: number;
  entry?: boolean;
  exit?: boolean;
  context?: string;
};

export type Transition = {
  fromKey: string;
  toKey: string;
  label?: string;
  self?: boolean;
};

export type UIAction = {
  screenId: string;
  context?: string;
  componentId: string;
  action: string;
};

import type { Diagnostic, DiagnosticResult } from "../types/diagnostic.js";

export type ValidationResult = DiagnosticResult & {
  screens: Map<string, Screen>;
  config: MobileSpecConfig;
  transitions: Transition[];
  uiActions: UIAction[];
  stateScreens: Set<string>;
  /** 構造化診断情報 */
  diagnostics: Diagnostic[];
};
