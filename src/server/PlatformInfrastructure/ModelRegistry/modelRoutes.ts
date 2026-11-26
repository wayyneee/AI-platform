// 模型的 HTTP 路由：列出、查參數、偵測、測試、新增、換 key、刪除。
// 每件事結束時依 log 原則寫一筆：偵測、測試會連到供應商，成功失敗都寫；新增、換 key、刪除會改變資料，成功失敗都寫；
// 列出只在失敗時寫。log 只記 key 的名稱。

import type { FastifyInstance } from 'fastify';

import type {
  DetectedModel,
  ModelConnectionChoice,
  ModelTestInput,
  ModelType,
  NewModel,
  ParamDefinition,
  SavedModel,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { logFailure, logFailureAsync, logOutcome, logOutcomeAsync } from '../SystemLog/index.ts';
import { findApiKey } from './apiKeyStore.ts';
import {
  addModel,
  detectModels,
  getModelParams,
  hasLiveParams,
  testModel,
} from './modelDetection.ts';
import { deleteModel, findModel, listModels, updateModelKey } from './modelStore.ts';
import {
  describeKey,
  describeLlmUsage,
  describeModel,
  providerLogName,
  typeLogName,
} from './registryLogText.ts';

const MODULE_NAME = 'PlatformInfrastructure';
const MODEL_TYPES = ['llm', 'image', 'video', 'audio'];

// ===== 請求格式 =====

const connectionProperties = {
  type: { type: 'string', enum: MODEL_TYPES },
  provider: { type: 'string' },
  keyId: { type: 'string' },
  address: { type: 'string' },
};

const detectModelsBodySchema = {
  type: 'object',
  required: ['type', 'provider'],
  additionalProperties: false,
  properties: connectionProperties,
};

const testModelBodySchema = {
  type: 'object',
  required: ['type', 'provider', 'modelId'],
  additionalProperties: false,
  properties: { ...connectionProperties, modelId: { type: 'string' } },
};

const priceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    inputPerMillionTokens: { type: 'number' },
    outputPerMillionTokens: { type: 'number' },
    perSearch: { type: 'number' },
    perUnit: { type: 'number' },
  },
};

const addModelBodySchema = {
  type: 'object',
  required: ['type', 'provider', 'modelId', 'displayName', 'price'],
  additionalProperties: false,
  properties: {
    ...connectionProperties,
    modelId: { type: 'string' },
    displayName: { type: 'string' },
    price: priceSchema,
  },
};

const updateModelKeyBodySchema = {
  type: 'object',
  required: ['id', 'keyId'],
  additionalProperties: false,
  properties: { id: { type: 'string' }, keyId: { type: 'string' } },
};

const idSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string' } },
};

const listModelsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { type: { type: 'string', enum: MODEL_TYPES } },
};

// ===== 路由 =====

/** 登記模型的路由：`listModels`、`getModelParams`、`detectModels`、`testModel`、`addModel`、`updateModelKey`、`deleteModel`。 */
export async function registerModelRoutes(server: FastifyInstance): Promise<void> {
  registerQueryRoutes(server);
  registerProviderRoutes(server);
  registerChangeRoutes(server);
}

/** 查詢：列出是單純讀取本機資料，只在失敗時寫；查參數要即時查詢選項時會連到供應商，成功也寫。 */
function registerQueryRoutes(server: FastifyInstance): void {
  server.get<{ Querystring: { type?: ModelType } }>(
    '/listModels',
    { schema: { querystring: listModelsQuerySchema } },
    async (request): Promise<{ models: SavedModel[] }> => ({
      models: logFailure(MODULE_NAME, '列出模型', () => listModels(request.query.type)),
    }),
  );

  server.get<{ Querystring: { id: string } }>(
    '/getModelParams',
    { schema: { querystring: idSchema } },
    async (request): Promise<{ params: ParamDefinition[] }> => {
      const model = findModel(request.query.id);
      const action = `查詢模型參數：${model ? describeSavedModel(model) : request.query.id}`;
      const extra = { keyName: keyNameOf(model?.keyId) };
      const work = () => getModelParams(request.query.id);
      const isQueryingProvider = Boolean(model && hasLiveParams(model.params));
      const params = isQueryingProvider
        ? await logOutcomeAsync(MODULE_NAME, action, work, extra)
        : await logFailureAsync(MODULE_NAME, action, work, extra);
      return { params };
    },
  );
}

/** 偵測、測試：會連到供應商，成功和失敗都寫。 */
function registerProviderRoutes(server: FastifyInstance): void {
  server.post<{ Body: ModelConnectionChoice }>(
    '/detectModels',
    { schema: { body: detectModelsBodySchema } },
    async (request): Promise<{ models: DetectedModel[] }> => {
      const choice = request.body;
      const action = `偵測模型：${describeConnection(choice)}的${typeLogName(choice.type)}`;
      const result = await logOutcomeAsync(
        MODULE_NAME,
        action,
        () => detectModels(choice),
        { keyName: keyNameOf(choice.keyId) },
        ({ models }) => ({ status: `偵測到 ${models.length} 個模型` }),
      );
      return { models: result.models };
    },
  );

  server.post<{ Body: ModelTestInput }>(
    '/testModel',
    { schema: { body: testModelBodySchema } },
    async (request): Promise<{ isPassed: boolean }> => {
      const input = request.body;
      const action = `測試模型：${describeModel(input.modelId, input.provider, input.type)}`;
      await logOutcomeAsync(
        MODULE_NAME,
        action,
        () => testModel(input),
        { keyName: keyNameOf(input.keyId) },
        ({ usage }) => (usage ? { usage: describeLlmUsage(usage) } : {}),
      );
      return { isPassed: true };
    },
  );
}

/** 新增、換 key、刪除：會改變資料，成功和失敗都寫。 */
function registerChangeRoutes(server: FastifyInstance): void {
  server.post<{ Body: NewModel }>(
    '/addModel',
    { schema: { body: addModelBodySchema } },
    async (request): Promise<{ model: SavedModel }> => {
      const input = request.body;
      const name = input.displayName.trim() || input.modelId;
      const action = `新增模型：${describeModel(name, input.provider, input.type)}`;
      const model = logOutcome(MODULE_NAME, action, () => addModel(input), {
        keyName: keyNameOf(input.keyId),
      });
      return { model };
    },
  );

  server.post<{ Body: { id: string; keyId: string } }>(
    '/updateModelKey',
    { schema: { body: updateModelKeyBodySchema } },
    async (request): Promise<{ model: SavedModel }> => {
      const { id, keyId } = request.body;
      const existing = findModel(id);
      const keyName = keyNameOf(keyId);
      const target = existing ? describeSavedModel(existing) : id;
      const action = `修改模型的 key：${target}，改用「${keyName ?? keyId}」`;
      const model = logOutcome(MODULE_NAME, action, () => updateModelKey(id, keyId), { keyName });
      return { model };
    },
  );

  server.post<{ Body: { id: string } }>(
    '/deleteModel',
    { schema: { body: idSchema } },
    async (request): Promise<{ model: SavedModel }> => {
      const { id } = request.body;
      const existing = findModel(id);
      const action = `刪除模型：${existing ? describeSavedModel(existing) : id}`;
      const model = logOutcome(MODULE_NAME, action, () => deleteModel(id), {
        keyName: keyNameOf(existing?.keyId),
      });
      return { model };
    },
  );
}

// ===== log 文字 =====

function describeSavedModel(model: SavedModel): string {
  return describeModel(model.displayName, model.provider, model.type);
}

/** 例如「個人（OpenRouter）」；Forge 為「Forge（http://127.0.0.1:7860）」。 */
function describeConnection(choice: ModelConnectionChoice): string {
  const key = choice.keyId ? findApiKey(choice.keyId) : undefined;
  if (key) return describeKey(key.provider, key.name);
  const target = choice.address ?? choice.keyId ?? '';
  return `${providerLogName(choice.provider)}（${target}）`;
}

/** key 的名稱；找不到或沒有 key（Forge）時為 undefined。 */
function keyNameOf(keyId: string | null | undefined): string | undefined {
  return keyId ? findApiKey(keyId)?.name : undefined;
}
