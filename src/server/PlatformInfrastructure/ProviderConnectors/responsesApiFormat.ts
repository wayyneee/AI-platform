// Responses API 的格式轉換：OpenAI 和 Grok（xAI）都用這個格式送出對話，差異（網址、搜尋工具、思考摘要、溫度、搜尋次數、錯誤判斷）由各家的檔案提供。
// 對話一律不讓供應商保存（store: false），每次把完整歷史送出；上一輪的輸出項目透過 replay 原樣送回。

import {
  LLM_PARAM_KEYS,
  type ChatFinishReason,
  type ChatInput,
  type ChatMessage,
  type ChatResult,
  type ChatStreamEvent,
  type ChatToolCall,
  type ProviderId,
  type SearchSource,
} from '../../../shared/PlatformInfrastructure/types.ts';
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  attachmentFileName,
  isReplayFor,
  isWebSearchOn,
  joinParagraphs,
  parseToolArguments,
  readNumberParam,
  readStringParam,
  toDataUrl,
  uniqueSources,
} from './chatHelpers.ts';
import type { ChatRequest } from './connectorTypes.ts';
import {
  createProviderError,
  parseProviderJson,
  readProviderJson,
  sendProviderRequest,
  toProviderError,
  type ClassifyProviderError,
  type ProviderCallContext,
  type ProviderErrorCode,
} from './providerRequest.ts';
import { readServerSentEvents } from './serverSentEvents.ts';

/** 各家在 Responses 格式上的差異。 */
export interface ResponsesDialect {
  provider: ProviderId;
  /** 完整的 /responses 網址 */
  url: string;
  /** 開啟網頁搜尋時加進 tools 的項目 */
  webSearchTool: Record<string, unknown>;
  /** 設定思考程度時，是否一併要求思考摘要（OpenAI 要有 summary 才會回傳思考內容） */
  requestsReasoningSummary: boolean;
  supportsTemperature: boolean;
  classifyError: ClassifyProviderError;
  /** 從完整回應算出網頁搜尋次數 */
  countSearches: (response: Record<string, unknown>) => number;
}

type JsonObject = Record<string, unknown>;

// ===== 送出 =====

/** 送出對話並取得完整結果。 */
export async function sendResponsesChat(
  request: ChatRequest,
  dialect: ResponsesDialect,
): Promise<ChatResult> {
  const context = callContext(request, dialect, 'sendChat');
  const response = await sendProviderRequest({
    ...context,
    url: dialect.url,
    headers: authorizationHeader(request.apiKey),
    body: buildResponsesBody(request, dialect, false),
    classifyError: dialect.classifyError,
  });
  const body = await readProviderJson<JsonObject>(response, context);
  return parseResponsesResult(body, request.model, dialect, context);
}

/** 串流對話：逐段送出回覆文字與思考內容，最後一段是完整結果。 */
export async function* streamResponsesChat(
  request: ChatRequest,
  dialect: ResponsesDialect,
): AsyncGenerator<ChatStreamEvent> {
  const context = callContext(request, dialect, 'streamChat');
  const response = await sendProviderRequest({
    ...context,
    url: dialect.url,
    headers: authorizationHeader(request.apiKey),
    body: buildResponsesBody(request, dialect, true),
    classifyError: dialect.classifyError,
  });
  let result: ChatResult | undefined;
  try {
    for await (const event of readServerSentEvents(response.body!)) {
      if (event.data === '[DONE]') continue;
      const payload = asRecord(parseProviderJson(event.data, context));
      const type = asString(payload.type) || event.event;
      const delta = toStreamDelta(type, payload);
      if (delta) yield delta;
      if (type === 'response.completed' || type === 'response.incomplete') {
        result = parseResponsesResult(asRecord(payload.response), request.model, dialect, context);
      }
      if (type === 'response.failed' || type === 'error') throw streamFailure(payload, context);
    }
  } catch (error) {
    throw toProviderError(error, context);
  }
  if (!result)
    throw createProviderError(context, 'PROVIDER_RESPONSE_INVALID', { reason: '串流沒有完成事件' });
  yield { type: 'done', result };
}

// ===== 組請求 =====

/** 把平台的對話格式轉成 Responses 的請求內容。 */
export function buildResponsesBody(
  request: ChatRequest,
  dialect: ResponsesDialect,
  isStream: boolean,
): JsonObject {
  const { params, input } = request;
  const body: JsonObject = {
    model: request.model,
    input: buildInputItems(input, dialect.provider, request.model),
    store: false,
  };
  if (isStream) body.stream = true;
  if (input.systemPrompt) body.instructions = input.systemPrompt;

  const tools = buildTools(input, isWebSearchOn(params) ? dialect.webSearchTool : undefined);
  if (tools.length > 0) body.tools = tools;

  const maxOutputTokens = readNumberParam(params, LLM_PARAM_KEYS.maxOutputTokens);
  if (maxOutputTokens !== undefined) body.max_output_tokens = maxOutputTokens;
  const temperature = readNumberParam(params, LLM_PARAM_KEYS.temperature);
  if (dialect.supportsTemperature && temperature !== undefined) body.temperature = temperature;

  const effort = readStringParam(params, LLM_PARAM_KEYS.reasoningEffort);
  if (effort) {
    body.reasoning = dialect.requestsReasoningSummary ? { effort, summary: 'auto' } : { effort };
    // 不保存對話時，推理內容要以加密形式拿回來，下一輪才能原樣送回
    body.include = ['reasoning.encrypted_content'];
  }
  return body;
}

function buildInputItems(input: ChatInput, provider: ProviderId, model: string): unknown[] {
  return input.messages.flatMap((message) => toInputItems(message, provider, model));
}

function toInputItems(message: ChatMessage, provider: ProviderId, model: string): unknown[] {
  if (message.role === 'user') return [toUserItem(message)];
  if (message.role === 'tool') {
    return message.results.map((result) => ({
      type: 'function_call_output',
      call_id: result.callId,
      output: result.content,
    }));
  }
  if (isReplayFor(message.replay, provider, model)) return asArray(message.replay.data);
  const items: unknown[] = [];
  if (message.text) items.push({ role: 'assistant', content: message.text });
  for (const call of message.toolCalls ?? []) {
    items.push({
      type: 'function_call',
      call_id: call.id,
      name: call.name,
      arguments: JSON.stringify(call.arguments),
    });
  }
  return items;
}

function toUserItem(message: Extract<ChatMessage, { role: 'user' }>): JsonObject {
  const content: unknown[] = [{ type: 'input_text', text: message.text }];
  (message.attachments ?? []).forEach((attachment, index) => {
    if (attachment.kind === 'image') {
      content.push({ type: 'input_image', image_url: toDataUrl(attachment) });
      return;
    }
    content.push({
      type: 'input_file',
      filename: attachmentFileName(attachment, index),
      file_data: toDataUrl(attachment),
    });
  });
  return { role: 'user', content };
}

function buildTools(input: ChatInput, webSearchTool: JsonObject | undefined): unknown[] {
  const tools: unknown[] = (input.tools ?? []).map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
  if (webSearchTool) tools.push(webSearchTool);
  return tools;
}

// ===== 解析回應 =====

/** 把完整的 Responses 回應轉成平台的統一格式。 */
export function parseResponsesResult(
  response: JsonObject,
  model: string,
  dialect: ResponsesDialect,
  context: ProviderCallContext,
): ChatResult {
  const output = asArray(response.output).map(asRecord);
  const messageParts = output
    .filter((item) => item.type === 'message')
    .flatMap((item) => asArray(item.content).map(asRecord));
  const toolCalls = output
    .filter((item) => item.type === 'function_call')
    .map((item) => toToolCall(item, context));
  const usage = asRecord(response.usage);

  return {
    text: messageParts.map((part) => asString(part.text)).join(''),
    thinking: joinParagraphs(output.filter((item) => item.type === 'reasoning').map(readReasoning)),
    toolCalls,
    sources: uniqueSources([...annotationSources(messageParts), ...searchCallSources(output)]),
    usage: {
      inputTokens: asNumber(usage.input_tokens),
      outputTokens: asNumber(usage.output_tokens),
      searchCount: dialect.countSearches(response),
    },
    finishReason: readFinishReason(response, messageParts, toolCalls),
    replay: { provider: dialect.provider, model, data: replayItems(output) },
  };
}

/** 數 web_search_call 項目當作搜尋次數（OpenAI 依每次搜尋計費）；打開網頁、頁內搜尋不算。 */
export function countWebSearchCalls(response: JsonObject): number {
  return asArray(response.output)
    .map(asRecord)
    .filter((item) => item.type === 'web_search_call')
    .filter((item) => {
      const actionType = asRecord(item.action).type;
      return actionType === undefined || actionType === 'search';
    }).length;
}

/** 失敗事件、錯誤物件裡的文字代碼轉成本專案的錯誤代碼。 */
export function classifyResponsesErrorCode(code: string): ProviderErrorCode {
  if (code === 'rate_limit_exceeded' || code === 'slow_down') return 'PROVIDER_RATE_LIMITED';
  if (
    code === 'insufficient_quota' ||
    code.endsWith('_exhausted') ||
    code.includes('limit_exceeded')
  ) {
    return 'PROVIDER_QUOTA_EXCEEDED';
  }
  if (code.startsWith('invalid_') || code.includes('too_large')) return 'PROVIDER_BAD_REQUEST';
  return 'PROVIDER_SERVER_ERROR';
}

function toToolCall(item: JsonObject, context: ProviderCallContext): ChatToolCall {
  return {
    id: asString(item.call_id),
    name: asString(item.name),
    arguments: parseToolArguments(asString(item.arguments), context),
  };
}

/** 思考內容：OpenAI 在 summary，Grok 可能在 content（reasoning_text）。 */
function readReasoning(item: JsonObject): string {
  const summary = asArray(item.summary).map((part) => asString(asRecord(part).text));
  const content = asArray(item.content).map((part) => asString(asRecord(part).text));
  return joinParagraphs([...summary, ...content]);
}

/** 回覆文字上的 url_citation 標註；OpenAI 直接放在標註上，其他家可能包在 url_citation 底下。 */
function annotationSources(messageParts: JsonObject[]): SearchSource[] {
  return messageParts
    .flatMap((part) => asArray(part.annotations).map(asRecord))
    .filter((annotation) => annotation.type === 'url_citation')
    .map((annotation) => {
      const nested = asRecord(annotation.url_citation);
      const url = asString(annotation.url) || asString(nested.url);
      const title = asString(annotation.title) || asString(nested.title);
      return title ? { url, title } : { url };
    });
}

/** 搜尋動作本身帶的來源（要求 include 時才有），當作補充。 */
function searchCallSources(output: JsonObject[]): SearchSource[] {
  return output
    .filter((item) => item.type === 'web_search_call')
    .flatMap((item) => asArray(asRecord(item.action).sources).map(asRecord))
    .map((source) => ({ url: asString(source.url) }));
}

function readFinishReason(
  response: JsonObject,
  messageParts: JsonObject[],
  toolCalls: ChatToolCall[],
): ChatFinishReason {
  if (response.status === 'incomplete') {
    const reason = asRecord(response.incomplete_details).reason;
    if (reason === 'max_output_tokens') return 'length';
    if (reason === 'content_filter') return 'refused';
    return 'other';
  }
  if (messageParts.some((part) => part.type === 'refusal')) return 'refused';
  if (toolCalls.length > 0) return 'toolCalls';
  return 'stop';
}

/** 下一輪要送回的輸出項目；沒有加密內容的推理項目送回去會找不到，先拿掉。 */
function replayItems(output: JsonObject[]): JsonObject[] {
  return output.filter(
    (item) => item.type !== 'reasoning' || asString(item.encrypted_content) !== '',
  );
}

// ===== 串流 =====

function toStreamDelta(type: string | undefined, payload: JsonObject): ChatStreamEvent | undefined {
  const delta = asString(payload.delta);
  if (!delta) return undefined;
  if (type === 'response.output_text.delta') return { type: 'text', text: delta };
  if (
    type === 'response.reasoning_summary_text.delta' ||
    type === 'response.reasoning_text.delta'
  ) {
    return { type: 'thinking', text: delta };
  }
  return undefined;
}

/** 串流中途失敗：response.failed 的錯誤在 response.error，error 事件的錯誤在事件本身。 */
function streamFailure(payload: JsonObject, context: ProviderCallContext) {
  const error = asRecord(asRecord(payload.response).error);
  const code = asString(error.code) || asString(payload.code);
  return createProviderError(context, classifyResponsesErrorCode(code), { streamError: payload });
}

// ===== 輔助 =====

function callContext(
  request: ChatRequest,
  dialect: ResponsesDialect,
  interfaceName: string,
): ProviderCallContext {
  return {
    provider: dialect.provider,
    interfaceName,
    apiKey: request.apiKey,
    signal: request.signal,
  };
}

/** Bearer 驗證標頭（OpenAI、Grok、OpenRouter 都用這個）。 */
export function authorizationHeader(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}
