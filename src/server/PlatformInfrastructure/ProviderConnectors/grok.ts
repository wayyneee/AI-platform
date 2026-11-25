// Grok（xAI）的串接：用 Responses API 送出對話（xAI 的網頁搜尋只在這個 API），模型清單用 /v1/language-models 加 /v1/models。
// 價格單位：token 價格是「美分 / 1 億 token」，搜尋價格是「美分 / 1 億次」（xAI 官方文件）。

import type {
  ChatResult,
  ChatStreamEvent,
  DetectedModel,
  LlmCapabilities,
  ModelPrice,
} from '../../../shared/PlatformInfrastructure/types.ts';
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  buildCommonParams,
  toLimit,
} from './chatHelpers.ts';
import type { ChatRequest, ProviderConnector } from './connectorTypes.ts';
import { classifyByStatus, requestProviderJson } from './providerRequest.ts';
import {
  authorizationHeader,
  countWebSearchCalls,
  sendResponsesChat,
  streamResponsesChat,
  type ResponsesDialect,
} from './responsesApiFormat.ts';

const BASE_URL = 'https://api.x.ai/v1';
// 美分 / 1 億 token → 美元 / 100 萬 token
const TOKEN_PRICE_TO_USD_PER_MILLION = 1 / 10_000;
// 美分 / 1 億次 → 美元 / 次
const SEARCH_PRICE_TO_USD_PER_SEARCH = 1 / 10_000_000_000;
const TEMPERATURE_RANGE = { min: 0, max: 2 };

type JsonObject = Record<string, unknown>;

const dialect: ResponsesDialect = {
  provider: 'grok',
  url: `${BASE_URL}/responses`,
  webSearchTool: { type: 'web_search' },
  requestsReasoningSummary: false,
  supportsTemperature: true,
  classifyError: classifyByStatus,
  countSearches: countGrokSearches,
};

export const grokConnector: ProviderConnector = {
  provider: 'grok',
  listChatModels,
  sendChat: (request: ChatRequest): Promise<ChatResult> => sendResponsesChat(request, dialect),
  streamChat: (request: ChatRequest): AsyncGenerator<ChatStreamEvent> =>
    streamResponsesChat(request, dialect),
};

// ===== 偵測模型 =====

/** 列出輸出文字的模型；context window 只有 /v1/models 有，兩份清單合併。 */
async function listChatModels(apiKey: string, signal?: AbortSignal): Promise<DetectedModel[]> {
  const request = { provider: 'grok' as const, interfaceName: 'listChatModels', apiKey, signal };
  const headers = authorizationHeader(apiKey);
  const [languageModels, allModels] = await Promise.all([
    requestProviderJson<JsonObject>({
      ...request,
      url: `${BASE_URL}/language-models`,
      headers,
      classifyError: classifyByStatus,
    }),
    requestProviderJson<JsonObject>({
      ...request,
      url: `${BASE_URL}/models`,
      headers,
      classifyError: classifyByStatus,
    }),
  ]);
  const contextWindows = readContextWindows(allModels);
  return asArray(languageModels.models)
    .map(asRecord)
    .filter((model) => asArray(model.output_modalities).includes('text'))
    .map((model) => toDetectedModel(model, contextWindows));
}

function toDetectedModel(model: JsonObject, contextWindows: Map<string, number>): DetectedModel {
  const id = asString(model.id);
  const efforts = asArray(asRecord(model.capabilities).reasoning_effort).map(asString);
  const capabilities: LlmCapabilities = {
    imageInput: asArray(model.input_modalities).includes('image') ? 'yes' : 'no',
    fileInput: 'unknown',
    // 有搜尋價格代表供應商標示可以搜尋；沒有不代表不行，標未知
    webSearch: asNumber(model.search_price) > 0 ? 'yes' : 'unknown',
    // 有思考程度選項代表是思考模型；空清單只代表不能調，不代表不思考
    thinking: efforts.length > 0 ? 'yes' : 'unknown',
    tools: 'unknown',
    contextWindow: toLimit(contextWindows.get(id)),
    maxOutputTokens: null,
  };
  return {
    id,
    displayName: id,
    type: 'llm',
    capabilities,
    price: readPrice(model),
    params: buildCommonParams(capabilities, {
      hasMaxOutputTokens: true,
      temperatureRange: TEMPERATURE_RANGE,
      reasoningEfforts: efforts,
    }),
  };
}

function readContextWindows(allModels: JsonObject): Map<string, number> {
  const entries = asArray(allModels.data)
    .map(asRecord)
    .map((model): [string, number] => [asString(model.id), asNumber(model.context_length)]);
  return new Map(entries);
}

function readPrice(model: JsonObject): ModelPrice {
  const price: ModelPrice = {
    inputPerMillionTokens: asNumber(model.prompt_text_token_price) * TOKEN_PRICE_TO_USD_PER_MILLION,
    outputPerMillionTokens:
      asNumber(model.completion_text_token_price) * TOKEN_PRICE_TO_USD_PER_MILLION,
  };
  const searchPrice = asNumber(model.search_price);
  if (searchPrice > 0) price.perSearch = searchPrice * SEARCH_PRICE_TO_USD_PER_SEARCH;
  return price;
}

// ===== 用量 =====

/** xAI 在用量裡直接回報網頁搜尋次數；沒有時才自己數。 */
function countGrokSearches(response: JsonObject): number {
  const details = asRecord(asRecord(response.usage).server_side_tool_usage_details);
  if (typeof details.web_search_calls === 'number') return details.web_search_calls;
  return countWebSearchCalls(response);
}
