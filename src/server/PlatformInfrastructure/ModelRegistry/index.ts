// ModelRegistry 後端的唯一入口：API key、模型的新增與管理、偵測、測試、可調參數，以及它們的路由。

export {
  addApiKey,
  ApiKeyErrorCodes,
  deleteApiKey,
  getApiKeyValue,
  listApiKeys,
  maskApiKey,
  updateApiKey,
} from './apiKeyStore.ts';
export { registerApiKeyRoutes } from './apiKeyRoutes.ts';
export { ModelConnectionErrorCodes, resolveSavedModelConnection } from './modelConnection.ts';
export type { ResolvedConnection } from './modelConnection.ts';
export {
  addModel,
  detectModels,
  getModelParams,
  ModelDetectionErrorCodes,
  testModel,
} from './modelDetection.ts';
export {
  deleteModel,
  listModels,
  ModelStoreErrorCodes,
  requireModel,
  updateModelKey,
} from './modelStore.ts';
export { registerModelRoutes } from './modelRoutes.ts';
