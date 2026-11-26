// 已儲存模型的資料：換 key 要同一家供應商、刪除模型、類型對照表和各家串接一致。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MODEL_TYPE_PROVIDERS,
  PROVIDERS_REQUIRING_KEY,
  type MediaModelType,
  type ModelType,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { closeAllDatabases } from '../PlatformBootstrap/index.ts';
import { getChatConnector, getMediaConnector } from '../ProviderConnectors/index.ts';
import { isPlatformError } from '../SystemLog/index.ts';
import { addApiKey } from './apiKeyStore.ts';
import { resolveConnection } from './modelConnection.ts';
import { deleteModel, insertModel, listModels, updateModelKey } from './modelStore.ts';
import { LLM_MODEL } from './modelTestSupport.ts';

const MEDIA_TYPES: MediaModelType[] = ['image', 'video', 'audio'];

let dataDirectory: string;

beforeEach(() => {
  dataDirectory = mkdtempSync(path.join(tmpdir(), 'platform-model-store-'));
  vi.stubEnv('PLATFORM_DATA_DIR', dataDirectory);
});

afterEach(() => {
  closeAllDatabases();
  vi.unstubAllEnvs();
  rmSync(dataDirectory, { recursive: true, force: true });
});

function catchErrorCode(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    if (isPlatformError(error)) return error.code;
    throw error;
  }
  throw new Error('預期要丟出錯誤，但沒有');
}

/** 不經偵測直接存一個 OpenRouter 的 LLM 模型（偵測與測試的流程在 modelDetection.test）。 */
function insertOpenRouterModel(keyId: string) {
  const connection = resolveConnection({ type: 'llm', provider: 'openrouter', keyId }, 'addModel');
  return insertModel(
    { detected: LLM_MODEL, connection, displayName: 'Claude Sonnet', price: {} },
    'addModel',
  );
}

describe('ModelRegistry 模型資料', () => {
  it('替模型選了不同供應商的 key 時回報錯誤，資料不被修改', () => {
    const keyId = addApiKey({
      provider: 'openrouter',
      name: '個人',
      keyValue: 'sk-or-0123456789',
    }).id;
    const grokKeyId = addApiKey({ provider: 'grok', name: '個人', keyValue: 'xai-0123456789' }).id;
    const model = insertOpenRouterModel(keyId);

    expect(catchErrorCode(() => updateModelKey(model.id, grokKeyId))).toBe(
      'MODEL_KEY_PROVIDER_MISMATCH',
    );
    expect(catchErrorCode(() => updateModelKey(model.id, 'missing'))).toBe('API_KEY_NOT_FOUND');
    expect(listModels()[0].keyId).toBe(keyId);
  });

  it('換成同一家供應商的另一組 key', () => {
    const keyId = addApiKey({
      provider: 'openrouter',
      name: '個人',
      keyValue: 'sk-or-0123456789',
    }).id;
    const otherId = addApiKey({
      provider: 'openrouter',
      name: '工作',
      keyValue: 'sk-or-9876543210',
    }).id;
    const model = insertOpenRouterModel(keyId);
    expect(updateModelKey(model.id, otherId).keyId).toBe(otherId);
    expect(listModels()[0].keyId).toBe(otherId);
  });

  it('刪除模型後列表查不到；刪除不存在的模型回報 MODEL_NOT_FOUND', () => {
    const keyId = addApiKey({
      provider: 'openrouter',
      name: '個人',
      keyValue: 'sk-or-0123456789',
    }).id;
    const model = insertOpenRouterModel(keyId);
    expect(deleteModel(model.id).displayName).toBe('Claude Sonnet');
    expect(listModels()).toEqual([]);
    expect(catchErrorCode(() => deleteModel(model.id))).toBe('MODEL_NOT_FOUND');
  });

  it('各類型的供應商對照表和各家的串接一致', () => {
    const llmProviders = PROVIDERS_REQUIRING_KEY.filter((provider) => getChatConnector(provider));
    expect([...MODEL_TYPE_PROVIDERS.llm].sort()).toEqual([...llmProviders].sort());
    for (const type of MEDIA_TYPES) {
      const providers = (
        ['openai', 'gemini', 'claude', 'grok', 'openrouter', 'forge'] as const
      ).filter((provider) => getMediaConnector(provider)?.types.includes(type));
      expect([...MODEL_TYPE_PROVIDERS[type as ModelType]].sort()).toEqual([...providers].sort());
    }
  });
});
