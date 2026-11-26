// API key 的 HTTP 路由：列出、新增、修改、刪除；每件事結束時依 log 原則寫一筆，log 只記 key 的名稱。

import type { FastifyInstance } from 'fastify';

import type {
  ApiKeyChanges,
  ApiKeySummary,
  NewApiKey,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { logFailure, logOutcome } from '../SystemLog/index.ts';
import { addApiKey, deleteApiKey, findApiKey, listApiKeys, updateApiKey } from './apiKeyStore.ts';
import { describeKey } from './registryLogText.ts';

const MODULE_NAME = 'PlatformInfrastructure';
const addApiKeyBodySchema = {
  type: 'object',
  required: ['provider', 'name', 'keyValue'],
  additionalProperties: false,
  properties: {
    provider: { type: 'string' },
    name: { type: 'string' },
    keyValue: { type: 'string' },
  },
};

const updateApiKeyBodySchema = {
  type: 'object',
  required: ['id', 'name'],
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    keyValue: { type: 'string' },
  },
};

const deleteApiKeyBodySchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string' } },
};

/** 登記 API key 的路由：`listApiKeys`、`addApiKey`、`updateApiKey`、`deleteApiKey`。 */
export async function registerApiKeyRoutes(server: FastifyInstance): Promise<void> {
  // 單純讀取本機資料：只在失敗時寫 log
  server.get('/listApiKeys', async (): Promise<{ keys: ApiKeySummary[] }> => ({
    keys: logFailure(MODULE_NAME, '列出 API key', listApiKeys),
  }));

  // 以下會改變資料：成功和失敗都寫
  server.post<{ Body: NewApiKey }>(
    '/addApiKey',
    { schema: { body: addApiKeyBodySchema } },
    async (request): Promise<{ key: ApiKeySummary }> => {
      const { provider, name, keyValue } = request.body;
      const action = `新增 API key：${describeKey(provider, name)}`;
      const key = logOutcome(MODULE_NAME, action, () => addApiKey({ provider, name, keyValue }), {
        keyName: name.trim(),
      });
      return { key };
    },
  );

  server.post<{ Body: ApiKeyChanges }>(
    '/updateApiKey',
    { schema: { body: updateApiKeyBodySchema } },
    async (request): Promise<{ key: ApiKeySummary }> => {
      const { id, name, keyValue } = request.body;
      const action = describeUpdate(id, name, Boolean(keyValue?.trim()));
      const key = logOutcome(MODULE_NAME, action, () => updateApiKey({ id, name, keyValue }), {
        keyName: name.trim(),
      });
      return { key };
    },
  );

  server.post<{ Body: { id: string } }>(
    '/deleteApiKey',
    { schema: { body: deleteApiKeyBodySchema } },
    async (request): Promise<{ key: ApiKeySummary }> => {
      const { id } = request.body;
      const existing = findApiKey(id);
      const action = `刪除 API key：${existing ? describeKey(existing.provider, existing.name) : id}`;
      const key = logOutcome(MODULE_NAME, action, () => deleteApiKey(id), {
        keyName: existing?.name,
      });
      return { key };
    },
  );
}

// ===== log 文字 =====

/** 修改的 log 文字：標出改名前後、是否換了 key，方便從 log 看出做了什麼。 */
function describeUpdate(id: string, name: string, isKeyChanged: boolean): string {
  const existing = findApiKey(id);
  const newName = name.trim();
  if (!existing) return `修改 API key：${id}`;
  const renamed = existing.name === newName ? '' : `，名稱改為「${newName}」`;
  const keyChanged = isKeyChanged ? '，換新 key' : '';
  return `修改 API key：${describeKey(existing.provider, existing.name)}${renamed}${keyChanged}`;
}
