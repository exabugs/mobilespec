// src/openapiCheck.ts

export type OpenapiCheckOptions = {
  specsDir: string;
  schemaDir: string;
  openapiPath: string;
};

export type OpenapiCheckResult = {
  errors: string[];
  warnings: string[];
};

/**
 * OpenAPI と L4 の operationId 整合性チェック
 *
 * 現段階ではスケルトン。
 * 将来ここで：
 *  - OpenAPI を読み込み
 *  - operationId 一覧を抽出
 *  - L4 から参照されている operationId と照合
 */
export async function openapiCheck(_options: OpenapiCheckOptions): Promise<OpenapiCheckResult> {
  // TODO: 実装予定
  return {
    errors: [],
    warnings: [],
  };
}
