// OpenRouter 的串接：用 Chat Completions 送出對話（模型清單回報的可調參數都是這個 API 的參數），網頁搜尋用 openrouter:web_search 工具。
// 搜尋花費直接用它回報的金額（spec）；模型偵測在 openRouterModels.ts。

import {
  LLM_PARAM_KEYS,
  type ChatFinishReason,
  type ChatInput,
  type ChatMessage,
  type ChatResult,
  type ChatStreamEvent,
  type LlmUsage,
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
import type { ChatRequest, ProviderConnector } from './connectorTypes.ts';
import {
  classifyByStatus,
  createProviderError,
  parseProviderJson,
  readProviderJson,
  sendProviderRequest,
  toProviderError,
  type ProviderCallContext,
} from './providerRequest.ts';
import { listOpenRouterChatModels, OPENROUTER_EXTRA_PARAMS } from './openRouterModels.ts';
import { authorizationHeader } from './responsesApiFormat.ts';
import { readServerSentEvents } from './serverSentEvents.ts';

const BASE_URL = 'https://openrouter.ai/api/v1';

type JsonObject = Record<string, unknown>;

export const openRouterConnector: ProviderConnector = {
  provider: 'openrouter',
  listChatModels: listOpenRouterChatModels,
  sendChat,
  streamChat,
};

// ===== 送出 =====

async function sendChat(request: ChatRequest): Promise<ChatResult> {
  const context = callContext(request, 'sendChat');
  const response = await sendProviderRequest({
    ...context,
    url: `${BASE_URL}/chat/completions`,
    headers: authorizationHeader(request.apiKey),
    body: buildChatBody(request, false),
    classifyError: classifyByStatus,
  });
  const body = await readProviderJson<JsonObject>(response, context);
  // OpenRouter 可能在 HTTP 200 的內容裡放錯誤
  if (body.error) throw bodyError(asRecord(body.error), context);
  const choice = asRecord(asArray(body.choices)[0]);
  return parseChatResult(
    asRecord(choice.message),
    choice.finish_reason,
    body.usage,
    request,
    context,
  );
}

async function* streamChat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
  const context = callContext(request, 'streamChat');
  const response = await sendProviderRequest({
    ...context,
    url: `${BASE_URL}/chat/completions`,
    headers: authorizationHeader(request.apiKey),
    body: buildChatBody(request, true),
    classifyError: classifyByStatus,
  });
  const assembled = emptyAssembly();
  try {
    for await (const event of readServerSentEvents(response.body!)) {
      if (event.data === '[DONE]') continue;
      const chunk = asRecord(parseProviderJson(event.data, context));
      // 串流中途的錯誤：HTTP 已經是 200，錯誤放在事件裡
      if (chunk.error) throw bodyError(asRecord(chunk.error), context);
      yield* applyChunk(assembled, chunk);
    }
  } catch (error) {
    throw toProviderError(error, context);
  }
  const message = assembledMessage(assembled);
  yield {
    type: 'done',
    result: parseChatResult(message, assembled.finishReason, assembled.usage, request, context),
  };
}

// ===== 組請求 =====

/** 把平台的對話格式轉成 Chat Completions 的請求內容。 */
function buildChatBody(request: ChatRequest, isStream: boolean): JsonObject {
  const { params } = request;
  const body: JsonObject = {
    model: request.model,
    messages: buildMessages(request.input, request.model),
  };
  if (isStream) body.stream = true;

  const tools: unknown[] = (request.input.tools ?? []).map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
  if (isWebSearchOn(params)) tools.push({ type: 'openrouter:web_search' });
  if (tools.length > 0) body.tools = tools;

  const maxOutputTokens = readNumberParam(params, LLM_PARAM_KEYS.maxOutputTokens);
  if (maxOutputTokens !== undefined) body.max_completion_tokens = maxOutputTokens;
  const temperature = readNumberParam(params, LLM_PARAM_KEYS.temperature);
  if (temperature !== undefined) body.temperature = temperature;
  const effort = readStringParam(params, LLM_PARAM_KEYS.reasoningEffort);
  if (effort) body.reasoning = { effort };
  for (const { apiName, definition } of OPENROUTER_EXTRA_PARAMS) {
    const value = readNumberParam(params, definition.key);
    if (value !== undefined) body[apiName] = value;
  }
  return body;
}

function buildMessages(input: ChatInput, model: string): unknown[] {
  const messages: unknown[] = [];
  if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt });
  for (const message of input.messages) messages.push(...toChatMessages(message, model));
  return messages;
}

function toChatMessages(message: ChatMessage, model: string): unknown[] {
  if (message.role === 'tool') {
    return message.results.map((result) => ({
      role: 'tool',
      tool_call_id: result.callId,
      content: result.content,
    }));
  }
  if (message.role === 'user') {
    const content: unknown[] = [{ type: 'text', text: message.text }];
    (message.attachments ?? []).forEach((attachment, index) => {
      content.push(
        attachment.kind === 'image'
          ? { type: 'image_url', image_url: { url: toDataUrl(attachment) } }
          : {
              type: 'file',
              file: {
                filename: attachmentFileName(attachment, index),
                file_data: toDataUrl(attachment),
              },
            },
      );
    });
    return [{ role: 'user', content }];
  }
  // 思考模型做工具來回時，要把上一輪的 reasoning_details 原樣送回（OpenRouter 文件）
  if (isReplayFor(message.replay, 'openrouter', model)) return [message.replay.data];
  const assistant: JsonObject = { role: 'assistant', content: message.text || null };
  if (message.toolCalls?.length) {
    assistant.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    }));
  }
  return [assistant];
}

// ===== 解析回應 =====

function parseChatResult(
  message: JsonObject,
  finishReason: unknown,
  rawUsage: unknown,
  request: ChatRequest,
  context: ProviderCallContext,
): ChatResult {
  const toolCalls = asArray(message.tool_calls)
    .map(asRecord)
    .map((call) => {
      const fn = asRecord(call.function);
      return {
        id: asString(call.id),
        name: asString(fn.name),
        arguments: parseToolArguments(asString(fn.arguments), context),
      };
    });
  return {
    text: asString(message.content),
    thinking: readThinking(message),
    toolCalls,
    sources: readSources(message),
    usage: readUsage(rawUsage),
    finishReason: toFinishReason(finishReason, toolCalls.length > 0),
    replay: { provider: 'openrouter', model: request.model, data: replayMessage(message) },
  };
}

/** 思考內容：優先用 reasoning 文字，沒有時從 reasoning_details 的文字或摘要組出來。 */
function readThinking(message: JsonObject): string {
  const reasoning = asString(message.reasoning);
  if (reasoning) return reasoning;
  return joinParagraphs(
    asArray(message.reasoning_details)
      .map(asRecord)
      .map((detail) => asString(detail.text) || asString(detail.summary)),
  );
}

function readSources(message: JsonObject): SearchSource[] {
  return uniqueSources(
    asArray(message.annotations)
      .map(asRecord)
      .filter((annotation) => annotation.type === 'url_citation')
      .map((annotation) => {
        const citation = asRecord(annotation.url_citation);
        const title = asString(citation.title);
        const url = asString(citation.url);
        return title ? { url, title } : { url };
      }),
  );
}

/** 用量：搜尋次數和搜尋金額都用 OpenRouter 回報的值。 */
function readUsage(rawUsage: unknown): LlmUsage {
  const usage = asRecord(rawUsage);
  const usageResult: LlmUsage = {
    inputTokens: asNumber(usage.prompt_tokens),
    outputTokens: asNumber(usage.completion_tokens),
    searchCount: asNumber(asRecord(usage.server_tool_use_details).web_search_requests),
  };
  const searchCost = asRecord(usage.cost_details).server_tool_cost;
  if (typeof searchCost === 'number') usageResult.reportedSearchCostUsd = searchCost;
  return usageResult;
}

function toFinishReason(reason: unknown, hasToolCalls: boolean): ChatFinishReason {
  if (reason === 'length') return 'length';
  if (reason === 'content_filter') return 'refused';
  if (hasToolCalls || reason === 'tool_calls') return 'toolCalls';
  if (reason === 'stop') return 'stop';
  return 'other';
}

/** 下一輪原樣送回的助手訊息：只留 OpenRouter 接受的欄位。 */
function replayMessage(message: JsonObject): JsonObject {
  const replay: JsonObject = { role: 'assistant', content: message.content ?? null };
  if (asArray(message.tool_calls).length > 0) replay.tool_calls = message.tool_calls;
  if (asArray(message.reasoning_details).length > 0)
    replay.reasoning_details = message.reasoning_details;
  return replay;
}

/** 回應內容裡的錯誤（HTTP 200 或串流中途），錯誤的 code 就是 HTTP 狀態。 */
function bodyError(error: JsonObject, context: ProviderCallContext) {
  return createProviderError(context, classifyByStatus(asNumber(error.code)), {
    status: asNumber(error.code),
    body: { error },
  });
}

// ===== 串流組裝 =====

interface StreamAssembly {
  content: string;
  reasoning: string;
  reasoningDetails: JsonObject[];
  toolCalls: JsonObject[];
  annotations: unknown[];
  finishReason: unknown;
  usage: unknown;
}

function emptyAssembly(): StreamAssembly {
  return {
    content: '',
    reasoning: '',
    reasoningDetails: [],
    toolCalls: [],
    annotations: [],
    finishReason: undefined,
    usage: undefined,
  };
}

/** 套用一個串流事件，回傳要送給呼叫端的增量。 */
function* applyChunk(assembled: StreamAssembly, chunk: JsonObject): Generator<ChatStreamEvent> {
  if (chunk.usage) assembled.usage = chunk.usage;
  const choice = asRecord(asArray(chunk.choices)[0]);
  if (choice.finish_reason) assembled.finishReason = choice.finish_reason;
  const delta = asRecord(choice.delta);

  const text = asString(delta.content);
  if (text) {
    assembled.content += text;
    yield { type: 'text', text };
  }
  const reasoning = asString(delta.reasoning);
  if (reasoning) {
    assembled.reasoning += reasoning;
    yield { type: 'thinking', text: reasoning };
  }
  asArray(delta.reasoning_details).forEach((detail) =>
    mergeIndexed(assembled.reasoningDetails, asRecord(detail)),
  );
  asArray(delta.tool_calls).forEach((call) => mergeToolCall(assembled.toolCalls, asRecord(call)));
  assembled.annotations.push(...asArray(delta.annotations));
}

/** 同一個 index 的 reasoning_details 片段接在一起（OpenRouter：依序串接）。 */
function mergeIndexed(details: JsonObject[], piece: JsonObject): void {
  const existing = details.find(
    (detail) => detail.index === piece.index && detail.type === piece.type,
  );
  if (!existing || piece.index === undefined) {
    details.push({ ...piece });
    return;
  }
  for (const field of ['text', 'summary', 'data']) {
    if (typeof piece[field] === 'string')
      existing[field] = asString(existing[field]) + piece[field];
  }
  if (piece.signature) existing.signature = piece.signature;
}

/** 工具請求的片段依 index 接起來：第一段有 id 和名稱，之後的 arguments 逐段補上。 */
function mergeToolCall(toolCalls: JsonObject[], piece: JsonObject): void {
  const index = asNumber(piece.index);
  const fn = asRecord(piece.function);
  const existing = toolCalls[index];
  if (!existing) {
    toolCalls[index] = {
      id: piece.id,
      type: 'function',
      function: { name: asString(fn.name), arguments: asString(fn.arguments) },
    };
    return;
  }
  const existingFn = asRecord(existing.function);
  existingFn.arguments = asString(existingFn.arguments) + asString(fn.arguments);
}

function assembledMessage(assembled: StreamAssembly): JsonObject {
  return {
    role: 'assistant',
    content: assembled.content || null,
    reasoning: assembled.reasoning,
    reasoning_details: assembled.reasoningDetails,
    tool_calls: assembled.toolCalls.filter(Boolean),
    annotations: assembled.annotations,
  };
}

// ===== 輔助 =====

function callContext(request: ChatRequest, interfaceName: string): ProviderCallContext {
  return { provider: 'openrouter', interfaceName, apiKey: request.apiKey, signal: request.signal };
}
