// OpenAI 的串接：用 Responses API 送出對話（網頁搜尋、思考摘要只有這個 API 有），模型清單用 /v1/models。
// OpenAI 的模型清單沒有能力、類型、價格資料：能力一律標未知，只列出名稱看得出是對話模型的項目。

import type {
  ChatResult,
  ChatStreamEvent,
  DetectedModel,
  LlmCapabilities,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { asArray, asRecord, asString, buildCommonParams } from './chatHelpers.ts';
import type { ChatRequest, ProviderConnector } from './connectorTypes.ts';
import {
  classifyByStatus,
  requestProviderJson,
  type ProviderErrorCode,
} from './providerRequest.ts';
import {
  authorizationHeader,
  classifyResponsesErrorCode,
  countWebSearchCalls,
  sendResponsesChat,
  streamResponsesChat,
  type ResponsesDialect,
} from './responsesApiFormat.ts';

const BASE_URL = 'https://api.openai.com/v1';
// 名稱看得出是對話模型的：gpt-、chatgpt-、o 系列推理模型
const CHAT_MODEL_PATTERN = /^(gpt-|chatgpt-|o\d)/;
// 同樣開頭但不是對話用的：嵌入、語音、圖片、即時、審核、搜尋專用等
const NON_CHAT_MODEL_PATTERN =
  /(embedding|tts|whisper|dall-e|image|audio|realtime|transcribe|moderation|sora|search)/;

const UNKNOWN_CAPABILITIES: LlmCapabilities = {
  imageInput: 'unknown',
  fileInput: 'unknown',
  webSearch: 'unknown',
  thinking: 'unknown',
  tools: 'unknown',
  contextWindow: null,
  maxOutputTokens: null,
};

const dialect: ResponsesDialect = {
  provider: 'openai',
  url: `${BASE_URL}/responses`,
  webSearchTool: { type: 'web_search' },
  requestsReasoningSummary: true,
  supportsTemperature: false,
  classifyError: classifyOpenAiError,
  countSearches: countWebSearchCalls,
};

export const openAiConnector: ProviderConnector = {
  provider: 'openai',
  listChatModels,
  sendChat: (request: ChatRequest): Promise<ChatResult> => sendResponsesChat(request, dialect),
  streamChat: (request: ChatRequest): AsyncGenerator<ChatStreamEvent> =>
    streamResponsesChat(request, dialect),
};

// ===== 偵測模型 =====

/** 列出對話模型；spec：OpenAI 沒有共通的可調參數，只有網頁搜尋開關（能力未知不算不支援）。 */
async function listChatModels(apiKey: string, signal?: AbortSignal): Promise<DetectedModel[]> {
  const body = await requestProviderJson<{ data?: unknown }>({
    provider: 'openai',
    interfaceName: 'listChatModels',
    url: `${BASE_URL}/models`,
    headers: authorizationHeader(apiKey),
    apiKey,
    signal,
    classifyError: classifyOpenAiError,
  });
  return asArray(body.data)
    .map((model) => asString(asRecord(model).id))
    .filter((id) => CHAT_MODEL_PATTERN.test(id) && !NON_CHAT_MODEL_PATTERN.test(id))
    .sort()
    .map((id) => ({
      id,
      displayName: id,
      type: 'llm',
      capabilities: { ...UNKNOWN_CAPABILITIES },
      params: buildCommonParams(UNKNOWN_CAPABILITIES, { hasMaxOutputTokens: false }),
    }));
}

// ===== 錯誤 =====

/** 429 分成額度不足（帳單類，重試也沒用）和太頻繁；其他依 HTTP 狀態。 */
function classifyOpenAiError(status: number, body: unknown): ProviderErrorCode {
  const error = asRecord(asRecord(body).error);
  if (status === 429) {
    const isBilling = error.type === 'insufficient_quota';
    const byCode = classifyResponsesErrorCode(asString(error.code));
    return isBilling || byCode === 'PROVIDER_QUOTA_EXCEEDED'
      ? 'PROVIDER_QUOTA_EXCEEDED'
      : 'PROVIDER_RATE_LIMITED';
  }
  return classifyByStatus(status);
}
