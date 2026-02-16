import type { Diagnostic, DiagnosticResult } from '../types/diagnostic.js';

/* ================================
 * Types
 * ================================ */

export type MobileSpecConfig = {
  mermaid: {
    groupOrder: string[];
    screenOrder?: string[];
  };

  i18n?: {
    // 例: ["ja", "en", "zh-Hans", "ko"]
    locales?: string[];
  };

  validation?: {
    allowNoIncoming?: string[];
  };

  openapi?: {
    // 例: "specs/openapi.yaml" など（specsDir からの相対でもOKにする運用が多い）
    path: string;

    // 導入期: 未使用 operationId を warning にするか（openapiCheck の L4_UNUSED_OPERATION_ID）
    warnUnusedOperationId?: boolean;

    // selectRoot をチェックするか（導入期は false でもOK）
    checkSelectRoot?: boolean;
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

export type ValidationResult = DiagnosticResult & {
  screens: Map<string, Screen>;
  config: MobileSpecConfig;
  transitions: Transition[];
  uiActions: UIAction[];
  stateScreens: Set<string>;
  /** 構造化診断情報 */
  diagnostics: Diagnostic[];
};
