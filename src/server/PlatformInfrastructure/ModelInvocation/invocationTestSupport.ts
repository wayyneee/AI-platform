// 模型呼叫測試共用的假串接與準備工作：不連到真的供應商，用 ModelRegistry 的正式流程（偵測 → 測試 → 儲存）建立模型。只給測試使用。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { vi } from 'vitest';

import type {
  ChatResult,
  ChatStreamEvent,
  DetectedModel,
  LogEntry,
  MediaModelType,
  MediaResult,
  ModelType,
  ProviderId,
  SavedModel,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { addApiKey, addModel, detectModels, testModel } from '../ModelRegistry/index.ts';
import type { ChatRequest, MediaRequest } from '../ProviderConnectors/index.ts';
import { closeAllDatabases } from '../PlatformBootstrap/index.ts';
import { createError, listLogs } from '../SystemLog/index.ts';
import { listUsageKeys } from '../UsageAndCost/index.ts';

export const CALLER = 'ChatRoom';
export const FORGE_ADDRESS = 'http://127.0.0.1:7860';

// ===== 假的模型 =====

export const LLM_MODEL: DetectedModel = {
  id: 'deepseek/deepseek-chat-v3',
  displayName: 'DeepSeek V3',
  type: 'llm',
  // 能力全部標「不支援」：用來確認本模組不依能力擋下呼叫
  capabilities: {
    imageInput: 'no',
    fileInput: 'no',
    webSearch: 'no',
    thinking: 'no',
    tools: 'no',
    contextWindow: null,
    maxOutputTokens: null,
  },
  price: { inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
  params: [
    { key: 'maxOutputTokens', kind: 'number', min: 1, max: 8000, isInteger: true, default: 1000 },
    { key: 'temperature', kind: 'number', min: 0, max: 2 },
    { key: 'reasoningEffort', kind: 'select', options: ['low', 'medium', 'high'] },
    { key: 'webSearch', kind: 'boolean', default: false },
  ],
};

export const IMAGE_MODEL: DetectedModel = {
  id: 'grok-imagine-image',
  displayName: 'Grok Imagine Image',
  type: 'image',
  params: [{ key: 'count', kind: 'number', min: 1, max: 10, isInteger: true, default: 1 }],
};

export const VIDEO_MODEL: DetectedModel = {
  id: 'grok-imagine-video',
  displayName: 'Grok Imagine Video',
  type: 'video',
  params: [{ key: 'duration', kind: 'number', min: 1, max: 15, isInteger: true, default: 6 }],
};

export const FORGE_MODEL: DetectedModel = {
  id: 'waiIllustriousSDXL_v150',
  displayName: 'waiIllustriousSDXL_v150',
  type: 'image',
  params: [
    { key: 'sampler', kind: 'select', options: [], hasLiveOptions: true, default: 'Euler a' },
    {
      key: 'loras',
      kind: 'weightedList',
      options: [],
      weight: { min: -2, max: 2, default: 1 },
      hasLiveOptions: true,
    },
  ],
};

export const LIVE_SAMPLERS = ['Euler a', 'DPM++ 2M'];
export const LIVE_LORAS = ['detailTweaker', 'flatColor'];

export const CHAT_RESULT: ChatResult = {
  text: '你好',
  thinking: '',
  toolCalls: [],
  sources: [],
  usage: { inputTokens: 1_000_000, outputTokens: 500_000, searchCount: 0 },
  finishReason: 'stop',
  replay: { provider: 'openrouter', model: LLM_MODEL.id, data: { signature: 'abc' } },
};

export const IMAGE_RESULT: MediaResult = {
  files: [{ mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) }],
  usage: { imageCount: 1, videoSeconds: 0, characterCount: 0 },
};

// ===== 假的串接 =====

export const fakeChat = {
  listChatModels: vi.fn(async () => [LLM_MODEL]),
  sendChat: vi.fn<(request: ChatRequest) => Promise<ChatResult>>(async () => CHAT_RESULT),
  streamChat: vi.fn(async function* (): AsyncGenerator<ChatStreamEvent> {
    yield { type: 'done', result: CHAT_RESULT };
  }),
};

export const fakeMedia = {
  listMediaModels: vi.fn(async (type: MediaModelType) => mediaModelsFor(type)),
  checkMediaModel: vi.fn(async () => undefined),
  listParamOptions: vi.fn(async (_type: MediaModelType, _model: string, paramKey: string) =>
    paramKey === 'loras' ? LIVE_LORAS : LIVE_SAMPLERS,
  ),
  generateMedia: vi.fn<(request: MediaRequest) => Promise<MediaResult>>(async () => IMAGE_RESULT),
};

/** 取代 ProviderConnectors 的入口：用 vi.mock 換掉 `../ProviderConnectors/index.ts`。 */
export const fakeProviderConnectors = {
  getChatConnector: (provider: ProviderId) =>
    provider === 'forge' ? undefined : { provider, ...fakeChat },
  getMediaConnector: (provider: ProviderId) =>
    ['grok', 'openrouter', 'forge'].includes(provider)
      ? { provider, types: ['image', 'video', 'audio'], ...fakeMedia }
      : undefined,
};

function mediaModelsFor(type: MediaModelType): DetectedModel[] {
  if (type === 'image') return [IMAGE_MODEL, FORGE_MODEL];
  if (type === 'video') return [VIDEO_MODEL];
  return [];
}

// ===== 測試前後 =====

let dataDirectory = '';

/** 每個測試開始前：資料指向暫存資料夾，假串接恢復預設的回應。 */
export function setUpInvocationTest(): void {
  dataDirectory = mkdtempSync(path.join(tmpdir(), 'platform-invocation-'));
  vi.stubEnv('PLATFORM_DATA_DIR', dataDirectory);
  for (const fake of [...Object.values(fakeChat), ...Object.values(fakeMedia)]) fake.mockClear();
  fakeChat.sendChat.mockImplementation(async () => CHAT_RESULT);
  fakeChat.streamChat.mockImplementation(async function* () {
    yield { type: 'done', result: CHAT_RESULT } as ChatStreamEvent;
  });
  fakeMedia.generateMedia.mockImplementation(async () => IMAGE_RESULT);
}

/** 每個測試結束後：關掉資料庫、刪掉暫存資料夾。 */
export function tearDownInvocationTest(): void {
  closeAllDatabases();
  vi.unstubAllEnvs();
  rmSync(dataDirectory, { recursive: true, force: true });
}

// ===== 建立模型 =====

/** 用正式流程新增一個雲端模型：新增 key → 偵測 → 測試 → 儲存。 */
export async function saveCloudModel(
  detected: DetectedModel,
  provider: ProviderId = 'openrouter',
): Promise<SavedModel> {
  const key = addApiKey({ provider, name: '個人', keyValue: `sk-test-${detected.id}` });
  const choice = { type: detected.type, provider, keyId: key.id };
  return saveModel(choice, detected);
}

/** 用正式流程新增一個 Forge 模型。 */
export async function saveForgeModel(address = FORGE_ADDRESS): Promise<SavedModel> {
  return saveModel({ type: 'image', provider: 'forge', address }, FORGE_MODEL);
}

async function saveModel(
  choice: { type: ModelType; provider: ProviderId; keyId?: string; address?: string },
  detected: DetectedModel,
): Promise<SavedModel> {
  await detectModels(choice);
  await testModel({ ...choice, modelId: detected.id });
  // 先開好用量的資料庫：第一次開啟時的「資料庫升級」log 不算在呼叫的 log 裡
  listUsageKeys();
  return addModel({
    ...choice,
    modelId: detected.id,
    displayName: detected.displayName,
    price: detected.price ?? {},
  });
}

// ===== 檢查 log =====

/** 從這個時間點之後寫入的 log，舊的在前。 */
export function startLogWatch(): () => LogEntry[] {
  const before = new Set(listLogs().map((entry) => entry.id));
  return () =>
    listLogs()
      .filter((entry) => !before.has(entry.id))
      .reverse();
}

/** 供應商的錯誤，例如 PROVIDER_REQUEST_REFUSED。 */
export function providerError(code: string, interfaceName = 'sendChat') {
  return createError('PlatformInfrastructure', interfaceName, code, `供應商回報 ${code}`);
}

/** 等到排在後面的 Promise 都跑完（假串接的回應、任務的狀態更新）。 */
export async function flushPromises(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await Promise.resolve();
}
