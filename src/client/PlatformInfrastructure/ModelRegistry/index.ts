// ModelRegistry 前端的唯一入口：API key、模型的查詢與管理。

export { addApiKey, deleteApiKey, listApiKeys, updateApiKey } from './apiKeyClient.ts';
export {
  addModel,
  deleteModel,
  detectModels,
  getModelParams,
  listModels,
  testModel,
  updateModelKey,
} from './modelClient.ts';
