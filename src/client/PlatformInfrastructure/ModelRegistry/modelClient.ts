// 前端的模型：向後端列出、查參數、偵測、測試、新增、換 key、刪除。key 只送編號，完整的 key 不經過前端。

import type {
  DetectedModel,
  ModelConnectionChoice,
  ModelTestInput,
  ModelType,
  NewModel,
  ParamDefinition,
  SavedModel,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { requestBackend } from '../SystemLog/index.ts';

const MODULE_NAME = 'PlatformInfrastructure';

/** 列出已儲存的模型（含能力），可依類型篩選；失敗時丟出錯誤物件。 */
export async function listModels(type?: ModelType): Promise<SavedModel[]> {
  const result = await requestBackend<{ models: SavedModel[] }>(MODULE_NAME, 'listModels', {
    query: { type },
  });
  return result.models;
}

/** 查詢模型的可調參數（即時選項已填入）；找不到模型時丟出 MODEL_NOT_FOUND 等錯誤物件。 */
export async function getModelParams(id: string): Promise<ParamDefinition[]> {
  const result = await requestBackend<{ params: ParamDefinition[] }>(
    MODULE_NAME,
    'getModelParams',
    {
      query: { id },
    },
  );
  return result.params;
}

/** 用選好的 key 或位址偵測可用的模型；Forge 沒有啟動時丟出 PROVIDER_FORGE_NOT_RUNNING 等錯誤物件。 */
export async function detectModels(choice: ModelConnectionChoice): Promise<DetectedModel[]> {
  const result = await requestBackend<{ models: DetectedModel[] }>(MODULE_NAME, 'detectModels', {
    body: choice,
  });
  return result.models;
}

/** 用這組設定測試模型；失敗時丟出 PROVIDER_KEY_INVALID 等錯誤物件。 */
export async function testModel(input: ModelTestInput): Promise<void> {
  await requestBackend<{ isPassed: boolean }>(MODULE_NAME, 'testModel', { body: input });
}

/** 儲存測試成功的模型；沒有測試成功時丟出 MODEL_NOT_TESTED 等錯誤物件。 */
export async function addModel(input: NewModel): Promise<SavedModel> {
  const result = await requestBackend<{ model: SavedModel }>(MODULE_NAME, 'addModel', {
    body: input,
  });
  return result.model;
}

/** 替模型換一組同供應商的 key；不同供應商時丟出 MODEL_KEY_PROVIDER_MISMATCH 等錯誤物件。 */
export async function updateModelKey(id: string, keyId: string): Promise<SavedModel> {
  const result = await requestBackend<{ model: SavedModel }>(MODULE_NAME, 'updateModelKey', {
    body: { id, keyId },
  });
  return result.model;
}

/** 刪除一個模型；找不到時丟出 MODEL_NOT_FOUND 等錯誤物件。 */
export async function deleteModel(id: string): Promise<void> {
  await requestBackend<{ model: SavedModel }>(MODULE_NAME, 'deleteModel', { body: { id } });
}
