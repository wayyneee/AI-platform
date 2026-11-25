// Gemini（Google）的串接：用 generateContent 送出對話（串流用 streamGenerateContent?alt=sse），模型清單用 models.list。
// 回覆的 parts 整份當作 replay，下一輪原樣送回（Gemini 3 的工具來回會檢查思考簽章）。key 放在標頭，不放網址。

import {
  LLM_PARAM_KEYS,
  type ChatFinishReason,
  type ChatInput,
  type ChatMessage,
  type ChatResult,
  type ChatStreamEvent,
  type ChatToolCall,
  type DetectedModel,
  type LlmCapabilities,
  type ParamValues,
} from '../../../shared/PlatformInfrastructure/types.ts';
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  buildCommonParams,
  isReplayFor,
  isWebSearchOn,
  joinParagraphs,
  readNumberParam,
  readStringParam,
  toLimit,
  toSupport,
  uniqueSources,
} from './chatHelpers.ts';
import type { ChatRequest, ProviderConnector } from './connectorTypes.ts';
import {
  classifyByStatus,
  parseProviderJson,
  readProviderJson,
  requestProviderJson,
  sendProviderRequest,
  toProviderError,
  type ProviderCallContext,
  type ProviderErrorCode,
} from './providerRequest.ts';
import { readServerSentEvents } from './serverSentEvents.ts';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_NAME_PREFIX = 'models/';
// Gemini 回應的工具請求可能沒有編號；平台自己編的號以這個開頭，送回時不帶編號
const GENERATED_CALL_ID_PREFIX = 'gemini-call-';
const REASONING_EFFORTS = ['low', 'medium', 'high'];
// Gemini 2.x 用思考 token 數，3 以後用思考等級（官方文件）
const THINKING_BUDGETS: Record<string, number> = { low: 1_024, medium: 8_192, high: 24_576 };
const FIRST_THINKING_LEVEL_VERSION = 3;
// 有 generateContent 但不是對話用的：嵌入、圖片、影片、語音、即時
const NON_CHAT_MODEL_PATTERN = /(embedding|imagen|veo|tts|image|native-audio|live|aqa)/;
const REFUSED_REASONS = ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'];
const MODEL_PAGE_SIZE = 1000;

type JsonObject = Record<string, unknown>;

export const geminiConnector: ProviderConnector = {
  provider: 'gemini',
  listChatModels,
  sendChat,
  streamChat,
};

// ===== 送出 =====

async function sendChat(request: ChatRequest): Promise<ChatResult> {
  const context = callContext(request, 'sendChat');
  const response = await sendProviderRequest({
    ...context,
    url: `${BASE_URL}/models/${request.model}:generateContent`,
    headers: geminiHeaders(request.apiKey),
    body: buildGenerateBody(request),
    classifyError: classifyGeminiError,
  });
  const body = await readProviderJson<JsonObject>(response, context);
  return parseGenerateResult(body, request.model);
}

async function* streamChat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
  const context = callContext(request, 'streamChat');
  const response = await sendProviderRequest({
    ...context,
    url: `${BASE_URL}/models/${request.model}:streamGenerateContent?alt=sse`,
    headers: geminiHeaders(request.apiKey),
    body: buildGenerateBody(request),
    classifyError: classifyGeminiError,
  });
  const assembly: StreamAssembly = { parts: [], latest: {} };
  try {
    for await (const event of readServerSentEvents(response.body!)) {
      const chunk = asRecord(parseProviderJson(event.data, context));
      yield* applyChunk(assembly, chunk);
    }
  } catch (error) {
    throw toProviderError(error, context);
  }
  yield { type: 'done', result: parseGenerateResult(assembledResponse(assembly), request.model) };
}

// ===== 組請求 =====

/** 把平台的對話格式轉成 generateContent 的請求內容。 */
function buildGenerateBody(request: ChatRequest): JsonObject {
  const { params, input } = request;
  const body: JsonObject = { contents: buildContents(input, request.model) };
  if (input.systemPrompt) body.systemInstruction = { parts: [{ text: input.systemPrompt }] };

  const tools: unknown[] = [];
  if (input.tools?.length) {
    tools.push({
      functionDeclarations: input.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.parameters,
      })),
    });
  }
  if (isWebSearchOn(params)) tools.push({ googleSearch: {} });
  if (tools.length > 0) body.tools = tools;

  const generationConfig = buildGenerationConfig(request.model, params);
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
  return body;
}

function buildGenerationConfig(model: string, params: ParamValues): JsonObject {
  const config: JsonObject = {};
  const maxOutputTokens = readNumberParam(params, LLM_PARAM_KEYS.maxOutputTokens);
  if (maxOutputTokens !== undefined) config.maxOutputTokens = maxOutputTokens;
  const effort = readStringParam(params, LLM_PARAM_KEYS.reasoningEffort);
  if (effort) {
    config.thinkingConfig = usesThinkingLevel(model)
      ? { includeThoughts: true, thinkingLevel: effort }
      : {
          includeThoughts: true,
          thinkingBudget: THINKING_BUDGETS[effort] ?? THINKING_BUDGETS.medium,
        };
  }
  return config;
}

/** 由模型名稱的版本判斷思考的設定方式（gemini-3、gemini-4… 用思考等級）。 */
function usesThinkingLevel(model: string): boolean {
  const version = Number.parseInt(/^gemini-(\d+)/.exec(model)?.[1] ?? '', 10);
  return Number.isFinite(version) && version >= FIRST_THINKING_LEVEL_VERSION;
}

function buildContents(input: ChatInput, model: string): unknown[] {
  return input.messages.map((message) => toContent(message, model));
}

function toContent(message: ChatMessage, model: string): JsonObject {
  if (message.role === 'user') {
    const attachments = (message.attachments ?? []).map((attachment) => ({
      inlineData: { mimeType: attachment.mimeType, data: attachment.data },
    }));
    return { role: 'user', parts: [{ text: message.text }, ...attachments] };
  }
  if (message.role === 'tool') {
    return {
      role: 'user',
      parts: message.results.map((result) => ({
        functionResponse: withCallId(
          { name: result.name, response: toResponseObject(result.content) },
          result.callId,
        ),
      })),
    };
  }
  if (isReplayFor(message.replay, 'gemini', model)) {
    return { role: 'model', parts: message.replay.data };
  }
  const parts: unknown[] = [];
  if (message.text) parts.push({ text: message.text });
  for (const call of message.toolCalls ?? []) {
    parts.push({ functionCall: withCallId({ name: call.name, args: call.arguments }, call.id) });
  }
  return { role: 'model', parts };
}

/** 工具結果要是物件：本來就是 JSON 物件就直接用，否則包成 { result }。 */
function toResponseObject(content: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  } catch {
    // 不是 JSON，落到下面包成文字
  }
  return { result: content };
}

/** 平台自己編的號不送出（Gemini 不認得）。 */
function withCallId(fields: JsonObject, callId: string): JsonObject {
  return callId.startsWith(GENERATED_CALL_ID_PREFIX) ? fields : { ...fields, id: callId };
}

// ===== 解析回應 =====

/** 把 generateContent 的回應轉成平台的統一格式。 */
function parseGenerateResult(response: JsonObject, model: string): ChatResult {
  const candidate = asRecord(asArray(response.candidates)[0]);
  const parts = asArray(asRecord(candidate.content).parts).map(asRecord);
  const textParts = parts.filter((part) => typeof part.text === 'string');
  const toolCalls = parts
    .filter((part) => part.functionCall)
    .map((part, index) => toToolCall(asRecord(part.functionCall), index));
  const grounding = asRecord(candidate.groundingMetadata);
  const usage = asRecord(response.usageMetadata);
  return {
    text: textParts
      .filter((part) => part.thought !== true)
      .map((part) => asString(part.text))
      .join(''),
    thinking: joinParagraphs(
      textParts.filter((part) => part.thought === true).map((part) => asString(part.text)),
    ),
    toolCalls,
    sources: uniqueSources(
      asArray(grounding.groundingChunks)
        .map((chunk) => asRecord(asRecord(chunk).web))
        .filter((web) => web.uri)
        .map((web) =>
          web.title
            ? { url: asString(web.uri), title: asString(web.title) }
            : { url: asString(web.uri) },
        ),
    ),
    usage: {
      inputTokens: asNumber(usage.promptTokenCount) + asNumber(usage.toolUsePromptTokenCount),
      // 思考的 token 也按輸出計費
      outputTokens: asNumber(usage.candidatesTokenCount) + asNumber(usage.thoughtsTokenCount),
      searchCount: countSearchQueries(grounding),
    },
    finishReason: toFinishReason(response, candidate, toolCalls.length > 0),
    replay: { provider: 'gemini', model, data: parts },
  };
}

function toToolCall(call: JsonObject, index: number): ChatToolCall {
  return {
    id: asString(call.id) || `${GENERATED_CALL_ID_PREFIX}${index}`,
    name: asString(call.name),
    arguments: asRecord(call.args),
  };
}

/** Gemini 依「不重複、非空白的搜尋字串」計費（官方文件），所以搜尋次數這樣算。 */
function countSearchQueries(grounding: JsonObject): number {
  const queries = asArray(grounding.webSearchQueries)
    .map(asString)
    .filter((query) => query.trim() !== '');
  return new Set(queries).size;
}

function toFinishReason(
  response: JsonObject,
  candidate: JsonObject,
  hasToolCalls: boolean,
): ChatFinishReason {
  if (asRecord(response.promptFeedback).blockReason) return 'refused';
  const reason = asString(candidate.finishReason);
  if (REFUSED_REASONS.includes(reason)) return 'refused';
  if (reason === 'MAX_TOKENS') return 'length';
  if (hasToolCalls) return 'toolCalls';
  if (reason === 'STOP') return 'stop';
  return 'other';
}

// ===== 串流組裝 =====

interface StreamAssembly {
  parts: JsonObject[];
  /** 最後一次出現的完成原因、用量、搜尋資料 */
  latest: {
    finishReason?: unknown;
    usageMetadata?: unknown;
    groundingMetadata?: unknown;
    promptFeedback?: unknown;
  };
}

/** 每個串流事件都是一份回應：把 parts 接起來，回傳要送給呼叫端的增量。 */
function* applyChunk(assembly: StreamAssembly, chunk: JsonObject): Generator<ChatStreamEvent> {
  const candidate = asRecord(asArray(chunk.candidates)[0]);
  if (chunk.usageMetadata) assembly.latest.usageMetadata = chunk.usageMetadata;
  if (chunk.promptFeedback) assembly.latest.promptFeedback = chunk.promptFeedback;
  if (candidate.finishReason) assembly.latest.finishReason = candidate.finishReason;
  if (candidate.groundingMetadata) assembly.latest.groundingMetadata = candidate.groundingMetadata;

  for (const part of asArray(asRecord(candidate.content).parts).map(asRecord)) {
    appendPart(assembly.parts, part);
    const text = asString(part.text);
    if (!text) continue;
    yield part.thought === true ? { type: 'thinking', text } : { type: 'text', text };
  }
}

/** 連續的同類文字片段合成一段（簽章跟著最後一段），其他 part 原樣加入。 */
function appendPart(parts: JsonObject[], part: JsonObject): void {
  const last = parts.at(-1);
  const isText = typeof part.text === 'string';
  const canMerge =
    last !== undefined &&
    isText &&
    typeof last.text === 'string' &&
    last.thought === part.thought &&
    !last.thoughtSignature;
  if (!canMerge) {
    parts.push({ ...part });
    return;
  }
  last.text = asString(last.text) + asString(part.text);
  if (part.thoughtSignature) last.thoughtSignature = part.thoughtSignature;
}

function assembledResponse(assembly: StreamAssembly): JsonObject {
  const { latest } = assembly;
  return {
    candidates: [
      {
        content: { role: 'model', parts: assembly.parts },
        finishReason: latest.finishReason,
        groundingMetadata: latest.groundingMetadata,
      },
    ],
    usageMetadata: latest.usageMetadata,
    promptFeedback: latest.promptFeedback,
  };
}

// ===== 偵測模型 =====

/** 列出能對話的模型（含分頁）；Gemini 只提供上限和是否會思考，其他能力標未知。 */
async function listChatModels(apiKey: string, signal?: AbortSignal): Promise<DetectedModel[]> {
  const models: JsonObject[] = [];
  let pageToken = '';
  for (;;) {
    const query = new URLSearchParams({ pageSize: String(MODEL_PAGE_SIZE) });
    if (pageToken) query.set('pageToken', pageToken);
    const page = await requestProviderJson<JsonObject>({
      provider: 'gemini',
      interfaceName: 'listChatModels',
      url: `${BASE_URL}/models?${query}`,
      headers: geminiHeaders(apiKey),
      apiKey,
      signal,
      classifyError: classifyGeminiError,
    });
    models.push(...asArray(page.models).map(asRecord));
    pageToken = asString(page.nextPageToken);
    if (!pageToken) break;
  }
  return models.filter(isChatModel).map(toDetectedModel);
}

function isChatModel(model: JsonObject): boolean {
  const methods = asArray(model.supportedGenerationMethods);
  return methods.includes('generateContent') && !NON_CHAT_MODEL_PATTERN.test(asString(model.name));
}

function toDetectedModel(model: JsonObject): DetectedModel {
  const id = asString(model.name).replace(MODEL_NAME_PREFIX, '');
  const capabilities: LlmCapabilities = {
    imageInput: 'unknown',
    fileInput: 'unknown',
    webSearch: 'unknown',
    thinking: toSupport(typeof model.thinking === 'boolean' ? model.thinking : undefined),
    tools: 'unknown',
    contextWindow: toLimit(model.inputTokenLimit),
    maxOutputTokens: toLimit(model.outputTokenLimit),
  };
  const detected: DetectedModel = {
    id,
    displayName: asString(model.displayName) || id,
    type: 'llm',
    capabilities,
    params: buildCommonParams(capabilities, {
      hasMaxOutputTokens: true,
      reasoningEfforts: REASONING_EFFORTS,
    }),
  };
  const description = asString(model.description);
  if (description) detected.description = description;
  return detected;
}

// ===== 錯誤 =====

/** Gemini 的 key 無效可能是 400（details 的 reason 為 API_KEY_INVALID）；帳單問題是 FAILED_PRECONDITION。 */
function classifyGeminiError(status: number, body: unknown): ProviderErrorCode {
  const error = asRecord(asRecord(body).error);
  const reasons = asArray(error.details).map((detail) => asString(asRecord(detail).reason));
  if (reasons.includes('API_KEY_INVALID') || error.code === 'authentication')
    return 'PROVIDER_KEY_INVALID';
  if (error.status === 'FAILED_PRECONDITION' || error.code === 'failed_precondition') {
    return 'PROVIDER_QUOTA_EXCEEDED';
  }
  if (error.code === 'quota_exceeded' || error.code === 'payment_required')
    return 'PROVIDER_QUOTA_EXCEEDED';
  return classifyByStatus(status);
}

// ===== 輔助 =====

function geminiHeaders(apiKey: string): Record<string, string> {
  return { 'x-goog-api-key': apiKey };
}

function callContext(request: ChatRequest, interfaceName: string): ProviderCallContext {
  return { provider: 'gemini', interfaceName, apiKey: request.apiKey, signal: request.signal };
}
