// 模型測試共用的假資料與假的供應商串接：不連到真的供應商，記下 ModelRegistry 送出了什麼。只給測試使用。

import { vi } from 'vitest';

import type {
  ChatResult,
  DetectedModel,
  MediaModelType,
  ProviderId,
} from '../../../shared/PlatformInfrastructure/types.ts';

// ===== 假的模型 =====

export const LLM_MODEL: DetectedModel = {
  id: 'anthropic/claude-sonnet-5.5',
  displayName: 'Anthropic: Claude Sonnet 5.5',
  type: 'llm',
  capabilities: {
    imageInput: 'yes',
    fileInput: 'yes',
    webSearch: 'unknown',
    thinking: 'yes',
    tools: 'yes',
    contextWindow: 1000000,
    maxOutputTokens: 128000,
  },
  price: { inputPerMillionTokens: 2, outputPerMillionTokens: 10 },
  params: [
    { key: 'maxOutputTokens', kind: 'number', min: 1, max: 128000, isInteger: true },
    { key: 'reasoningEffort', kind: 'select', options: ['low', 'medium', 'high'] },
    { key: 'webSearch', kind: 'boolean', default: false },
  ],
};

export const IMAGE_MODEL: DetectedModel = {
  id: 'grok-imagine-image',
  displayName: 'Grok Imagine Image',
  type: 'image',
  params: [{ key: 'count', kind: 'number', min: 1, max: 10, isInteger: true, default: 1 }],
  inputKinds: ['text', 'image'],
  outputKinds: ['image'],
};

export const VOICE_MODEL: DetectedModel = {
  id: 'grok-tts',
  displayName: 'Grok TTS',
  type: 'audio',
  params: [{ key: 'voice', kind: 'select', options: [], hasLiveOptions: true }],
};

export const FORGE_MODEL: DetectedModel = {
  id: 'waiIllustriousSDXL_v150',
  displayName: 'waiIllustriousSDXL_v150',
  type: 'image',
  params: [
    { key: 'steps', kind: 'number', min: 1, max: 150, isInteger: true, default: 20 },
    { key: 'sampler', kind: 'select', options: [], hasLiveOptions: true },
  ],
};

export const LIVE_VOICES = ['eve', 'rex'];
export const LIVE_SAMPLERS = ['Euler a', 'DPM++ 2M'];

export const CHAT_RESULT: ChatResult = {
  text: 'Hello',
  thinking: '',
  toolCalls: [],
  sources: [],
  usage: { inputTokens: 8, outputTokens: 2, searchCount: 0 },
  finishReason: 'stop',
  replay: { provider: 'openrouter', model: LLM_MODEL.id, data: null },
};

// ===== 假的串接 =====

export const fakeChat = {
  listChatModels: vi.fn(async () => [LLM_MODEL]),
  sendChat: vi.fn(async () => CHAT_RESULT),
  streamChat: vi.fn(),
};

export const fakeMedia = {
  listMediaModels: vi.fn(async (type: MediaModelType) => mediaModelsFor(type)),
  checkMediaModel: vi.fn(async () => undefined),
  listParamOptions: vi.fn(async (_type: MediaModelType, _model: string, paramKey: string) =>
    paramKey === 'voice' ? LIVE_VOICES : LIVE_SAMPLERS,
  ),
  generateMedia: vi.fn(async () => ({
    files: [],
    usage: { imageCount: 0, videoSeconds: 0, characterCount: 2 },
  })),
};

const CHAT_PROVIDERS: ProviderId[] = ['openai', 'gemini', 'claude', 'grok', 'openrouter'];
const MEDIA_TYPES: Partial<Record<ProviderId, MediaModelType[]>> = {
  grok: ['image', 'video', 'audio'],
  openrouter: ['image', 'video', 'audio'],
  forge: ['image'],
};

/** 取代 ProviderConnectors 的入口：用 vi.mock 換掉 `../ProviderConnectors/index.ts`。 */
export const fakeProviderConnectors = {
  getChatConnector: (provider: ProviderId) =>
    CHAT_PROVIDERS.includes(provider) ? { provider, ...fakeChat } : undefined,
  getMediaConnector: (provider: ProviderId) => {
    const types = MEDIA_TYPES[provider];
    return types ? { provider, types, ...fakeMedia } : undefined;
  },
};

/** 每個測試開始前清掉上一個測試的呼叫紀錄，恢復預設的回應。 */
export function resetFakeConnectors(): void {
  for (const fake of [...Object.values(fakeChat), ...Object.values(fakeMedia)]) {
    fake.mockClear();
  }
  fakeChat.listChatModels.mockImplementation(async () => [LLM_MODEL]);
  fakeChat.sendChat.mockImplementation(async () => CHAT_RESULT);
  fakeMedia.checkMediaModel.mockImplementation(async () => undefined);
}

function mediaModelsFor(type: MediaModelType): DetectedModel[] {
  if (type === 'audio') return [VOICE_MODEL];
  if (type === 'image') return [IMAGE_MODEL, FORGE_MODEL];
  return [];
}
