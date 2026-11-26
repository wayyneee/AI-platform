// 模型的路由：偵測、測試各剛好一筆 log；新增、換 key、刪除成功失敗都寫；key 不出現在回應與 log 中。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeAllDatabases } from '../PlatformBootstrap/index.ts';
import { createError, handleUnexpectedError, listLogs } from '../SystemLog/index.ts';
import { registerApiKeyRoutes } from './apiKeyRoutes.ts';
import { registerModelRoutes } from './modelRoutes.ts';
import { fakeChat, LLM_MODEL, resetFakeConnectors } from './modelTestSupport.ts';

// 換掉取得串接的方法；其餘（例如錯誤代碼的登記）用真的
vi.mock('../ProviderConnectors/index.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('./modelTestSupport.ts')).fakeProviderConnectors,
}));

const SECRET_KEY = 'sk-or-v1-SECRET-0123456789';
const API_PREFIX = '/api/PlatformInfrastructure';

let dataDirectory: string;
let server: FastifyInstance;
let keyId: string;

beforeEach(async () => {
  dataDirectory = mkdtempSync(path.join(tmpdir(), 'platform-model-routes-'));
  vi.stubEnv('PLATFORM_DATA_DIR', dataDirectory);
  resetFakeConnectors();
  server = Fastify();
  handleUnexpectedError(server);
  await server.register(registerApiKeyRoutes, { prefix: API_PREFIX });
  await server.register(registerModelRoutes, { prefix: API_PREFIX });
  const added = await post('addApiKey', {
    provider: 'openrouter',
    name: '個人',
    keyValue: SECRET_KEY,
  });
  keyId = added.json.key.id as string;
});

afterEach(async () => {
  await server.close();
  closeAllDatabases();
  vi.unstubAllEnvs();
  rmSync(dataDirectory, { recursive: true, force: true });
});

// ===== 輔助 =====

async function post(interfaceName: string, body: unknown) {
  const response = await server.inject({
    method: 'POST',
    url: `${API_PREFIX}/${interfaceName}`,
    payload: body as Record<string, unknown>,
  });
  return { status: response.statusCode, body: response.body, json: response.json() };
}

async function get(interfaceName: string, query: string) {
  const response = await server.inject({
    method: 'GET',
    url: `${API_PREFIX}/${interfaceName}?${query}`,
  });
  return { status: response.statusCode, body: response.body, json: response.json() };
}

/** 執行一件事，回傳這段期間寫的 log（由舊到新）。 */
async function logsDuring(work: () => Promise<unknown>) {
  const countBefore = listLogs().length;
  await work();
  const all = listLogs();
  return all.slice(0, all.length - countBefore).reverse();
}

const llmChoice = () => ({ type: 'llm', provider: 'openrouter', keyId });
const llmTest = () => ({ ...llmChoice(), modelId: LLM_MODEL.id });

describe('ModelRegistry 模型路由', () => {
  it('偵測、測試各剛好一筆 log', async () => {
    const detectLogs = await logsDuring(() => post('detectModels', llmChoice()));
    expect(detectLogs.map((log) => [log.level, log.action, log.status, log.keyName])).toEqual([
      ['success', '偵測模型：個人（OpenRouter）的LLM', '偵測到 1 個模型', '個人'],
    ]);

    const testLogs = await logsDuring(() => post('testModel', llmTest()));
    expect(testLogs.map((log) => [log.level, log.action, log.usage])).toEqual([
      ['success', `測試模型：${LLM_MODEL.id}（OpenRouter，LLM）`, '輸入 8 token、輸出 2 token'],
    ]);
  });

  it('偵測、測試失敗時也是剛好一筆 log，等級依錯誤代碼', async () => {
    fakeChat.listChatModels.mockImplementation(async () => {
      throw createError(
        'PlatformInfrastructure',
        'listChatModels',
        'PROVIDER_UNREACHABLE',
        '連不上',
      );
    });
    const detectLogs = await logsDuring(() => post('detectModels', llmChoice()));
    expect(detectLogs).toHaveLength(1);
    expect(detectLogs[0]).toMatchObject({
      level: 'error',
      error: { code: 'PROVIDER_UNREACHABLE' },
    });

    fakeChat.sendChat.mockImplementation(async () => {
      throw createError('PlatformInfrastructure', 'sendChat', 'PROVIDER_KEY_INVALID', 'key 無效');
    });
    const testResponse = { status: 0 };
    const testLogs = await logsDuring(async () => {
      testResponse.status = (await post('testModel', llmTest())).status;
    });
    expect(testResponse.status).toBe(400);
    expect(testLogs).toHaveLength(1);
    expect(testLogs[0]).toMatchObject({
      level: 'warning',
      error: { code: 'PROVIDER_KEY_INVALID' },
    });
  });

  it('新增、換 key、刪除成功各一筆 log；列出成功不寫 log', async () => {
    await post('detectModels', llmChoice());
    await post('testModel', llmTest());
    const otherKey = await post('addApiKey', {
      provider: 'openrouter',
      name: '工作',
      keyValue: SECRET_KEY,
    });
    const otherKeyId = otherKey.json.key.id as string;

    let modelId = '';
    const logs = await logsDuring(async () => {
      const added = await post('addModel', { ...llmTest(), displayName: 'Claude', price: {} });
      modelId = added.json.model.id as string;
      await get('listModels', 'type=llm');
      await post('updateModelKey', { id: modelId, keyId: otherKeyId });
      await post('deleteModel', { id: modelId });
    });
    expect(logs.map((log) => [log.level, log.action, log.keyName])).toEqual([
      ['success', '新增模型：Claude（OpenRouter，LLM）', '個人'],
      ['success', '修改模型的 key：Claude（OpenRouter，LLM），改用「工作」', '工作'],
      ['success', '刪除模型：Claude（OpenRouter，LLM）', '工作'],
    ]);
  });

  it('沒有測試就新增時回報 MODEL_NOT_TESTED，剛好一筆警告 log', async () => {
    const logs = await logsDuring(async () => {
      const response = await post('addModel', { ...llmTest(), displayName: 'Claude', price: {} });
      expect(response.status).toBe(400);
      expect(response.json.error.code).toBe('MODEL_NOT_TESTED');
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('warning');
  });

  it('API key 不出現在模型的回應與 log 中', async () => {
    const responses = [
      (await post('detectModels', llmChoice())).body,
      (await post('testModel', llmTest())).body,
    ];
    const added = await post('addModel', { ...llmTest(), displayName: 'Claude', price: {} });
    responses.push(added.body, (await get('listModels', '')).body);
    responses.push((await get('getModelParams', `id=${added.json.model.id}`)).body);
    responses.push(
      (await post('updateModelKey', { id: added.json.model.id, keyId: 'missing' })).body,
    );
    const everything = [...responses, JSON.stringify(listLogs())].join('\n');
    expect(everything).not.toContain(SECRET_KEY);
  });

  it('listModels 可以依類型篩選，能力一併回傳', async () => {
    await post('detectModels', llmChoice());
    await post('testModel', llmTest());
    await post('addModel', { ...llmTest(), displayName: 'Claude', price: {} });
    const llm = await get('listModels', 'type=llm');
    expect(llm.json.models).toHaveLength(1);
    expect(llm.json.models[0].capabilities).toEqual(LLM_MODEL.capabilities);
    expect((await get('listModels', 'type=image')).json.models).toEqual([]);
  });
});
