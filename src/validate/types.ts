import type { Diagnostic, DiagnosticLevel } from '../types/diagnostic.js';

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

    /**
     * 導入期: 未使用 operationId をどのレベルで出すか
     * - 'off'     : 出さない
     * - 'info'    : 情報（--fail-on-warnings でも落ちない）
     * - 'warning' : 警告（--fail-on-warnings で落ちる）
     * - 'error'   : エラー
     *
     * 後方互換:
     * - true  => 'warning'
     * - false => 'off'
     */
    warnUnusedOperationId?: DiagnosticLevel | 'off' | boolean;

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

export type ValidationResult = {
  screens: Map<string, Screen>;
  config: MobileSpecConfig;
  transitions: Transition[];
  uiActions: UIAction[];
  stateScreens: Set<string>;
  /** 構造化診断情報 */
  diagnostics: Diagnostic[];
};
