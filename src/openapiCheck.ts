export type OpenapiCheckOptions = {
  specsDir: string;
  schemaDir: string;
  openapiPath: string;
};

export type OpenapiCheckResult = {
  errors: string[];
  warnings: string[];
};

export async function openapiCheck(_opts: OpenapiCheckOptions): Promise<OpenapiCheckResult> {
  // TODO: OpenAPI YAML を読み、operationId一覧を抽出し、L4の参照と突合する
  return { errors: [], warnings: [] };
}
