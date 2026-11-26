// 設定頁測試共用的假後端與假資料：依網址最後一段（介面名稱）分派到假的路由，記下送出的內容。只給測試使用。

import { vi } from 'vitest';

import type {
  ApiKeySummary,
  DetectedModel,
  SavedModel,
} from '../../../shared/PlatformInfrastructure/types.ts';

export type FakeRoute = (body: Record<string, unknown>) => Response | Promise<Response>;

// ===== 假資料 =====

export const OPENROUTER_KEY: ApiKeySummary = {
  id: 'k1',
  provider: 'openrouter',
  name: '個人',
  maskedKey: 'sk-****a3f9',
};
export const SECOND_OPENROUTER_KEY: ApiKeySummary = {
  id: 'k2',
  provider: 'openrouter',
  name: '測試用',
  maskedKey: 'sk-****0c1e',
};
export const GROK_KEY: ApiKeySummary = {
  id: 'k3',
  provider: 'grok',
  name: '個人',
  maskedKey: 'xai****4kLm',
};

export const UNKNOWN_CAPABILITIES = {
  imageInput: 'unknown',
  fileInput: 'unknown',
  webSearch: 'unknown',
  thinking: 'unknown',
  tools: 'unknown',
  contextWindow: null,
  maxOutputTokens: null,
} as const;

export const OPENROUTER_LLM: SavedModel = {
  id: 'm1',
  type: 'llm',
  provider: 'openrouter',
  modelId: 'deepseek/deepseek-chat-v3',
  displayName: 'DeepSeek V3',
  keyId: 'k1',
  address: null,
  price: { inputPerMillionTokens: 0.3, outputPerMillionTokens: 0.88 },
  capabilities: { ...UNKNOWN_CAPABILITIES, webSearch: 'yes', contextWindow: 164000 },
  params: [],
};

export const DETECTED_LLMS: DetectedModel[] = [
  {
    id: 'anthropic/claude-sonnet-5.5',
    displayName: 'Anthropic: Claude Sonnet 5.5',
    description: '經由 OpenRouter 使用 Claude',
    type: 'llm',
    capabilities: {
      imageInput: 'yes',
      fileInput: 'yes',
      webSearch: 'yes',
      thinking: 'yes',
      tools: 'yes',
      contextWindow: 1000000,
      maxOutputTokens: 128000,
    },
    price: { inputPerMillionTokens: 3, outputPerMillionTokens: 15 },
    params: [],
  },
  {
    id: 'qwen/qwen3-235b',
    displayName: 'Qwen3 235B',
    type: 'llm',
    capabilities: { ...UNKNOWN_CAPABILITIES, webSearch: 'no', contextWindow: 131072 },
    price: { inputPerMillionTokens: 0.13, outputPerMillionTokens: 0.6 },
    params: [],
  },
];

// ===== 假後端 =====

/** 換掉 fetch：routes 可以在測試裡改，回傳送出內容的查詢方法。 */
export function installFakeBackend(routes: Record<string, FakeRoute>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const interfaceName = url.split('?')[0].split('/').pop()!;
    const route = routes[interfaceName];
    if (!route) throw new Error(`假後端沒有 ${interfaceName}`);
    return route(init?.body ? JSON.parse(init.body as string) : {});
  });
  vi.stubGlobal('fetch', fetchMock);

  /** 送給後端某個介面的所有內容。 */
  const sentBodies = (interfaceName: string): unknown[] =>
    fetchMock.mock.calls
      .filter(([url]) => String(url).split('?')[0].endsWith(`/${interfaceName}`))
      .map(([, init]) => (init?.body ? JSON.parse(init.body as string) : {}));

  return { fetchMock, sentBodies };
}

/** 後端回傳的錯誤。 */
export function errorResponse(interfaceName: string, code: string, status = 400): Response {
  return Response.json(
    { error: { module: 'PlatformInfrastructure', interfaceName, code, message: code } },
    { status },
  );
}
