// src/validate/types.ts
import type { Diagnostic } from '../types/diagnostic.js';

/* ================================
 * Types
 * ================================ */

export type MobileSpecConfig = {
  mermaid: {
    groupOrder: string[];
    screenOrder?: string[];
  };

  i18n?: {
    locales?: string[];
  };

  validation?: {
    allowNoIncoming?: string[];
  };

  openapi?: {
    path: string;
    checkSelectRoot?: boolean;
  };
};

export type Screen = {
  id: string;
  name: string;
  type?: 'screen' | 'choice';
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
  trigger?: 'tap' | 'auto';
  guard?: string;
  else?: boolean;
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
  diagnostics: Diagnostic[];
};
