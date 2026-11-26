// 模型的偵測、測試、新增、可調參數：測試不花錢、測試成功後才能儲存、能力跟著模型存下、即時選項向供應商查詢。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NewModel } from '../../../shared/PlatformInfrastructure/types.ts';
import { closeAllDatabases } from '../PlatformBootstrap/index.ts';
import { createError, isPlatformError } from '../SystemLog/index.ts';
import { addApiKey, deleteApiKey } from './apiKeyStore.ts';
import { resolveSavedModelConnection } from './modelConnection.ts';
import { addModel, detectModels, getModelParams, testModel } from './modelDetection.ts';
import { listModels, updateModelKey } from './modelStore.ts';
import {
  fakeChat,
  fakeMedia,
  FORGE_MODEL,
  LIVE_SAMPLERS,
  LIVE_VOICES,
  LLM_MODEL,
  resetFakeConnectors,
  VOICE_MODEL,
} from './modelTestSupport.ts';

// 換掉取得串接的方法；其餘（例如錯誤代碼的登記）用真的
vi.mock('../ProviderConnectors/index.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('./modelTestSupport.ts')).fakeProviderConnectors,
}));

const OPENROUTER_KEY = 'sk-or-v1-0123456789abcdef';
const FORGE_ADDRESS = 'http://127.0.0.1:7860';

let dataDirectory: string;
let keyId: string;

beforeEach(() => {
  dataDirectory = mkdtempSync(path.join(tmpdir(), 'platform-models-'));
  vi.stubEnv('PLATFORM_DATA_DIR', dataDirectory);
  resetFakeConnectors();
  keyId = addApiKey({ provider: 'openrouter', name: '個人', keyValue: OPENROUTER_KEY }).id;
});

afterEach(() => {
  closeAllDatabases();
  vi.unstubAllEnvs();
  rmSync(dataDirectory, { recursive: true, force: true });
});

// ===== 輔助 =====

async function catchErrorCode(work: () => unknown): Promise<string> {
  try {
    await work();
  } catch (error) {
    if (isPlatformError(error)) return error.code;
    throw error;
  }
  throw new Error('預期要丟出錯誤，但沒有');
}

function newLlmModel(overrides: Partial<NewModel> = {}): NewModel {
  return {
    type: 'llm',
    provider: 'openrouter',
    keyId,
    modelId: LLM_MODEL.id,
    displayName: 'Claude Sonnet',
    price: { inputPerMillionTokens: 2, outputPerMillionTokens: 10 },
    ...overrides,
  };
}

/** 偵測 → 測試 → 儲存，回傳存好的模型。 */
async function addTestedLlmModel(overrides: Partial<NewModel> = {}) {
  const input = newLlmModel(overrides);
  await detectModels(input);
  await testModel(input);
  return addModel(input);
}

// ===== 偵測 =====

describe('ModelRegistry 偵測模型', () => {
  it('用選好的 key 偵測，回傳供應商的模型清單（含能力、自動帶入的價格、可調參數）', async () => {
    const { models } = await detectModels({ type: 'llm', provider: 'openrouter', keyId });
    expect(models).toEqual([LLM_MODEL]);
    expect(fakeChat.listChatModels).toHaveBeenCalledWith(OPENROUTER_KEY);
  });

  it('Forge 用位址偵測，位址前後的空白和結尾的斜線會去掉', async () => {
    await detectModels({ type: 'image', provider: 'forge', address: ` ${FORGE_ADDRESS}/ ` });
    expect(fakeMedia.listMediaModels).toHaveBeenCalledWith('image', { address: FORGE_ADDRESS });
  });

  it('沒選 key、Forge 位址不是網址、供應商沒有這個類型時回報錯誤，不連到供應商', async () => {
    expect(await catchErrorCode(() => detectModels({ type: 'llm', provider: 'openrouter' }))).toBe(
      'MODEL_KEY_REQUIRED',
    );
    expect(
      await catchErrorCode(() =>
        detectModels({ type: 'image', provider: 'forge', address: '127.0.0.1:7860' }),
      ),
    ).toBe('MODEL_ADDRESS_INVALID');
    expect(
      await catchErrorCode(() => detectModels({ type: 'image', provider: 'claude', keyId })),
    ).toBe('MODEL_TYPE_INVALID');
    expect(fakeChat.listChatModels).not.toHaveBeenCalled();
    expect(fakeMedia.listMediaModels).not.toHaveBeenCalled();
  });

  it('替模型選了不同供應商的 key 時回報錯誤', async () => {
    expect(await catchErrorCode(() => detectModels({ type: 'llm', provider: 'grok', keyId }))).toBe(
      'MODEL_KEY_PROVIDER_MISMATCH',
    );
  });
});

// ===== 測試 =====

describe('ModelRegistry 測試模型（測試不花錢）', () => {
  it('LLM 送一則「Hi」，回覆上限 16 token', async () => {
    const { usage } = await testModel(newLlmModel());
    expect(fakeChat.sendChat).toHaveBeenCalledWith({
      model: LLM_MODEL.id,
      apiKey: OPENROUTER_KEY,
      input: { messages: [{ role: 'user', text: 'Hi' }] },
      params: { maxOutputTokens: 16 },
    });
    expect(usage).toEqual({ inputTokens: 8, outputTokens: 2, searchCount: 0 });
  });

  it('語音送「測試」兩個字；圖片、影片只確認 key 有效、模型存在，不實際生成', async () => {
    await testModel({ type: 'audio', provider: 'openrouter', keyId, modelId: VOICE_MODEL.id });
    expect(fakeMedia.generateMedia).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'audio', input: { prompt: '測試' } }),
    );

    fakeMedia.generateMedia.mockClear();
    await testModel({ type: 'image', provider: 'openrouter', keyId, modelId: 'some/image' });
    await testModel({ type: 'video', provider: 'openrouter', keyId, modelId: 'some/video' });
    expect(fakeMedia.checkMediaModel).toHaveBeenCalledTimes(2);
    expect(fakeMedia.generateMedia).not.toHaveBeenCalled();
  });

  it('供應商回報 key 無效時，測試回報供應商的錯誤', async () => {
    fakeChat.sendChat.mockImplementation(async () => {
      throw createError('PlatformInfrastructure', 'sendChat', 'PROVIDER_KEY_INVALID', 'key 無效');
    });
    expect(await catchErrorCode(() => testModel(newLlmModel()))).toBe('PROVIDER_KEY_INVALID');
  });
});

// ===== 新增 =====

describe('ModelRegistry 新增模型', () => {
  it('能力跟著模型存下，listModels 查得到', async () => {
    const saved = await addTestedLlmModel();
    expect(listModels('llm')).toEqual([saved]);
    expect(saved).toMatchObject({
      type: 'llm',
      provider: 'openrouter',
      modelId: LLM_MODEL.id,
      displayName: 'Claude Sonnet',
      keyId,
      address: null,
      capabilities: LLM_MODEL.capabilities,
      params: LLM_MODEL.params,
    });
    expect(listModels('image')).toEqual([]);
  });

  it('測試成功後才能儲存；測試失敗或沒測試時回報 MODEL_NOT_TESTED', async () => {
    const input = newLlmModel();
    await detectModels(input);
    expect(await catchErrorCode(() => addModel(input))).toBe('MODEL_NOT_TESTED');

    fakeChat.sendChat.mockImplementationOnce(async () => {
      throw new Error('連不上');
    });
    await expect(testModel(input)).rejects.toThrow();
    expect(await catchErrorCode(() => addModel(input))).toBe('MODEL_NOT_TESTED');
    expect(listModels()).toEqual([]);
  });

  it('測試成功後換了模型或 key，要重新測試才能儲存', async () => {
    const input = newLlmModel();
    await detectModels(input);
    await testModel(input);
    const otherKeyId = addApiKey({
      provider: 'openrouter',
      name: '工作',
      keyValue: OPENROUTER_KEY,
    }).id;
    expect(await catchErrorCode(() => addModel({ ...input, keyId: otherKeyId }))).toBe(
      'MODEL_NOT_TESTED',
    );
    expect(await catchErrorCode(() => addModel({ ...input, modelId: 'other/model' }))).toBe(
      'MODEL_NOT_TESTED',
    );
  });

  it('同一個模型可以用不同 key 新增多次，各自是一筆', async () => {
    const otherKeyId = addApiKey({
      provider: 'openrouter',
      name: '工作',
      keyValue: OPENROUTER_KEY,
    }).id;
    await addTestedLlmModel();
    await addTestedLlmModel({ keyId: otherKeyId, displayName: 'Claude（工作）' });
    expect(listModels().map((model) => model.keyId)).toEqual([keyId, otherKeyId]);
  });

  it('價格不能是負數；顯示名稱不能空白', async () => {
    const input = newLlmModel({ price: { inputPerMillionTokens: -1 } });
    await detectModels(input);
    await testModel(input);
    expect(await catchErrorCode(() => addModel(input))).toBe('MODEL_PRICE_INVALID');
    expect(await catchErrorCode(() => addModel({ ...input, price: {}, displayName: ' ' }))).toBe(
      'MODEL_NAME_REQUIRED',
    );
  });

  it('LLM 只填了輸入或輸出價格時另一個當 0；OpenRouter 不存每次搜尋價格；沒填價格時為空', async () => {
    const onlyInput = await addTestedLlmModel({
      price: { inputPerMillionTokens: 3, perSearch: 0.01 },
    });
    expect(onlyInput.price).toEqual({ inputPerMillionTokens: 3, outputPerMillionTokens: 0 });
    const noPrice = await addTestedLlmModel({ price: {} });
    expect(noPrice.price).toEqual({});
  });

  it('Forge 存位址、不存 key 和價格', async () => {
    const input: NewModel = {
      type: 'image',
      provider: 'forge',
      address: `${FORGE_ADDRESS}/`,
      modelId: FORGE_MODEL.id,
      displayName: '插畫風',
      price: { perUnit: 1 },
    };
    await detectModels(input);
    await testModel(input);
    expect(addModel(input)).toMatchObject({ keyId: null, address: FORGE_ADDRESS, price: {} });
  });
});

// ===== 刪除 key 後 =====

describe('ModelRegistry 刪除 key 後的模型', () => {
  it('刪除 key 後，選用它的模型 key 欄位變空，呼叫時回報錯誤；重新選 key 後可以正常呼叫', async () => {
    const saved = await addTestedLlmModel();
    deleteApiKey(keyId);
    const [cleared] = listModels();
    expect(cleared.keyId).toBeNull();
    expect(await catchErrorCode(() => resolveSavedModelConnection(cleared, 'invokeModel'))).toBe(
      'MODEL_KEY_MISSING',
    );

    const newKeyId = addApiKey({
      provider: 'openrouter',
      name: '新的',
      keyValue: OPENROUTER_KEY,
    }).id;
    const updated = updateModelKey(saved.id, newKeyId);
    expect(resolveSavedModelConnection(updated, 'invokeModel').connection).toEqual({
      apiKey: OPENROUTER_KEY,
    });
  });
});

// ===== 可調參數 =====

describe('ModelRegistry 查詢可調參數', () => {
  it('沒有即時選項時直接回傳存下的參數，不連到供應商', async () => {
    const saved = await addTestedLlmModel();
    expect(await getModelParams(saved.id)).toEqual(LLM_MODEL.params);
    expect(fakeMedia.listParamOptions).not.toHaveBeenCalled();
  });

  it('有即時選項的參數（Grok 的聲音、Forge 的取樣器）向供應商查詢後填入', async () => {
    const voiceInput: NewModel = {
      type: 'audio',
      provider: 'openrouter',
      keyId,
      modelId: VOICE_MODEL.id,
      displayName: '語音',
      price: {},
    };
    await detectModels(voiceInput);
    await testModel(voiceInput);
    const voice = addModel(voiceInput);
    expect(await getModelParams(voice.id)).toEqual([
      { key: 'voice', kind: 'select', options: LIVE_VOICES, hasLiveOptions: true },
    ]);

    const forgeInput: NewModel = {
      type: 'image',
      provider: 'forge',
      address: FORGE_ADDRESS,
      modelId: FORGE_MODEL.id,
      displayName: '插畫風',
      price: {},
    };
    await detectModels(forgeInput);
    await testModel(forgeInput);
    const forge = addModel(forgeInput);
    const params = await getModelParams(forge.id);
    expect(params[1]).toMatchObject({ key: 'sampler', options: LIVE_SAMPLERS });
    expect(fakeMedia.listParamOptions).toHaveBeenLastCalledWith(
      'image',
      FORGE_MODEL.id,
      'sampler',
      { address: FORGE_ADDRESS },
    );
  });

  it('找不到模型時回報 MODEL_NOT_FOUND', async () => {
    expect(await catchErrorCode(() => getModelParams('missing'))).toBe('MODEL_NOT_FOUND');
  });
});
