// Claude（Anthropic）的串接：用 Messages API 送出對話，模型清單用 Models API（有能力資料：圖片、PDF、網頁搜尋、思考、思考程度）。
// 思考內容、工具請求、搜尋結果都是回覆裡的區塊；整份區塊陣列當作 replay，下一輪原樣送回（思考簽章要原封不動）。

import {
  LLM_PARAM_KEYS,
  type ChatFinishReason,
  type ChatInput,
  type ChatMessage,
  type ChatResult,
  type ChatStreamEvent,
  type DetectedModel,
  type LlmCapabilities,
  type ParamValues,
  type SearchSource,
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
  parseToolArguments,
  readNumberParam,
  readStringParam,
  toLimit,
  uniqueSources,
} from './chatHelpers.ts';
import type { ChatRequest, ProviderConnector } from './connectorTypes.ts';
import {
  classifyByStatus,
  createProviderError,
  parseProviderJson,
  readProviderJson,
  requestProviderJson,
  sendProviderRequest,
  toProviderError,
  type ProviderCallContext,
  type ProviderErrorCode,
} from './providerRequest.ts';
import { readServerSentEvents } from './serverSentEvents.ts';

const BASE_URL = 'https://api.anthropic.com/v1';
const API_VERSION = '2026-10-21';
// Messages API 一定要給 max_tokens；呼叫端沒填時用這個值（不超過模型上限）
const DEFAULT_MAX_TOKENS = 16_000;
// 基本版網頁搜尋工具，新舊模型都能用
const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search' };
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const LEGACY_EFFORTS = ['low', 'medium', 'high'];
// 舊模型（4.5 以前）只接受指定思考 token 數，不接受自動思考；這份清單不會再增加
const LEGACY_THINKING_MODEL = /^claude-(3[-.]|(opus|sonnet|haiku)-4(-[0-5])?(-\d{8})?$)/;
const LEGACY_THINKING_BUDGETS: Record<string, number> = { low: 2_048, medium: 8_192, high: 16_384 };
const MODEL_PAGE_LIMIT = 1000;

type JsonObject = Record<string, unknown>;

export const claudeConnector: ProviderConnector = {
  provider: 'claude',
  listChatModels,
  sendChat,
  streamChat,
};

// ===== 送出 =====

async function sendChat(request: ChatRequest): Promise<ChatResult> {
  const context = callContext(request, 'sendChat');
  const response = await sendProviderRequest({
    ...context,
    url: `${BASE_URL}/messages`,
    headers: claudeHeaders(request.apiKey),
    body: buildMessagesBody(request, false),
    classifyError: classifyClaudeError,
  });
  const message = await readProviderJson<JsonObject>(response, context);
  return parseMessage(message, request.model, context);
}

async function* streamChat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
  const context = callContext(request, 'streamChat');
  const response = await sendProviderRequest({
    ...context,
    url: `${BASE_URL}/messages`,
    headers: claudeHeaders(request.apiKey),
    body: buildMessagesBody(request, true),
    classifyError: classifyClaudeError,
  });
  const assembly: StreamAssembly = { message: {}, blocks: [], partialJson: [] };
  try {
    for await (const event of readServerSentEvents(response.body!)) {
      const payload = asRecord(parseProviderJson(event.data, context));
      if (payload.type === 'error') throw streamError(payload, context);
      yield* applyStreamEvent(assembly, payload, context);
    }
  } catch (error) {
    throw toProviderError(error, context);
  }
  const message = { ...assembly.message, content: assembly.blocks };
  yield { type: 'done', result: parseMessage(message, request.model, context) };
}

// ===== 組請求 =====

/** 把平台的對話格式轉成 Messages API 的請求內容。 */
function buildMessagesBody(request: ChatRequest, isStream: boolean): JsonObject {
  const { params, input } = request;
  const body: JsonObject = {
    model: request.model,
    max_tokens: readNumberParam(params, LLM_PARAM_KEYS.maxOutputTokens) ?? DEFAULT_MAX_TOKENS,
    messages: buildMessages(input, request.model),
  };
  if (isStream) body.stream = true;
  if (input.systemPrompt) body.system = input.systemPrompt;

  const tools: unknown[] = (input.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
  if (isWebSearchOn(params)) tools.push(WEB_SEARCH_TOOL);
  if (tools.length > 0) body.tools = tools;

  applyThinking(body, request.model, params);
  return body;
}

/**
 * 思考程度：新模型用自動思考加 effort，並要求思考摘要（否則思考內容是空的）；
 * 舊模型改用指定思考 token 數，回應長度另外加上思考的量。
 */
function applyThinking(body: JsonObject, model: string, params: ParamValues): void {
  const effort = readStringParam(params, LLM_PARAM_KEYS.reasoningEffort);
  if (!effort) return;
  if (!LEGACY_THINKING_MODEL.test(model)) {
    body.thinking = { type: 'adaptive', display: 'summarized' };
    body.output_config = { effort };
    return;
  }
  const budget = LEGACY_THINKING_BUDGETS[effort] ?? LEGACY_THINKING_BUDGETS.medium;
  body.thinking = { type: 'enabled', budget_tokens: budget };
  body.max_tokens = asNumber(body.max_tokens) + budget;
}

function buildMessages(input: ChatInput, model: string): unknown[] {
  return input.messages.map((message) => toClaudeMessage(message, model));
}

function toClaudeMessage(message: ChatMessage, model: string): JsonObject {
  if (message.role === 'tool') {
    return {
      role: 'user',
      content: message.results.map((result) => ({
        type: 'tool_result',
        tool_use_id: result.callId,
        content: result.content,
      })),
    };
  }
  if (message.role === 'user') {
    // 官方建議：圖片、PDF 放在文字前面
    const attachments = (message.attachments ?? []).map((attachment) => ({
      type: attachment.kind === 'image' ? 'image' : 'document',
      source: { type: 'base64', media_type: attachment.mimeType, data: attachment.data },
    }));
    return { role: 'user', content: [...attachments, { type: 'text', text: message.text }] };
  }
  if (isReplayFor(message.replay, 'claude', model)) {
    return { role: 'assistant', content: message.replay.data };
  }
  const content: unknown[] = [];
  if (message.text) content.push({ type: 'text', text: message.text });
  for (const call of message.toolCalls ?? []) {
    content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
  }
  return { role: 'assistant', content };
}

// ===== 解析回應 =====

/** 把完整的 Message 轉成平台的統一格式。 */
function parseMessage(
  message: JsonObject,
  model: string,
  context: ProviderCallContext,
): ChatResult {
  const blocks = asArray(message.content).map(asRecord);
  const textBlocks = blocks.filter((block) => block.type === 'text');
  const toolCalls = blocks
    .filter((block) => block.type === 'tool_use')
    .map((block) => ({
      id: asString(block.id),
      name: asString(block.name),
      arguments: toToolInput(block.input, context),
    }));
  const usage = asRecord(message.usage);
  return {
    text: textBlocks.map((block) => asString(block.text)).join(''),
    thinking: joinParagraphs(
      blocks.filter((block) => block.type === 'thinking').map((block) => asString(block.thinking)),
    ),
    toolCalls,
    sources: readSources(blocks),
    usage: {
      // 讀寫快取的 token 也是輸入
      inputTokens:
        asNumber(usage.input_tokens) +
        asNumber(usage.cache_creation_input_tokens) +
        asNumber(usage.cache_read_input_tokens),
      outputTokens: asNumber(usage.output_tokens),
      searchCount: asNumber(asRecord(usage.server_tool_use).web_search_requests),
    },
    finishReason: toFinishReason(message.stop_reason),
    replay: { provider: 'claude', model, data: blocks },
  };
}

/** 來源：優先用回覆文字引用的網頁；沒有引用時列出搜尋到的結果。 */
function readSources(blocks: JsonObject[]): SearchSource[] {
  const cited = blocks
    .flatMap((block) => asArray(block.citations).map(asRecord))
    .filter((citation) => citation.type === 'web_search_result_location')
    .map(toSource);
  if (cited.length > 0) return uniqueSources(cited);
  const results = blocks
    .filter((block) => block.type === 'web_search_tool_result')
    .flatMap((block) => asArray(block.content).map(asRecord))
    .filter((result) => result.type === 'web_search_result')
    .map(toSource);
  return uniqueSources(results);
}

function toSource(item: JsonObject): SearchSource {
  const title = asString(item.title);
  return title ? { url: asString(item.url), title } : { url: asString(item.url) };
}

function toToolInput(input: unknown, context: ProviderCallContext): Record<string, unknown> {
  if (typeof input === 'string') return parseToolArguments(input, context);
  return asRecord(input);
}

function toFinishReason(reason: unknown): ChatFinishReason {
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
  if (reason === 'max_tokens') return 'length';
  if (reason === 'tool_use') return 'toolCalls';
  if (reason === 'refusal') return 'refused';
  return 'other';
}

// ===== 串流組裝 =====

interface StreamAssembly {
  message: JsonObject;
  blocks: JsonObject[];
  /** 工具內容的 JSON 片段，依區塊位置累積 */
  partialJson: string[];
}

/** 套用一個串流事件，把區塊組回完整的 Message，並回傳要送給呼叫端的增量。 */
function* applyStreamEvent(
  assembly: StreamAssembly,
  payload: JsonObject,
  context: ProviderCallContext,
): Generator<ChatStreamEvent> {
  const index = asNumber(payload.index);
  if (payload.type === 'message_start') assembly.message = { ...asRecord(payload.message) };
  if (payload.type === 'content_block_start') {
    assembly.blocks[index] = { ...asRecord(payload.content_block) };
    assembly.partialJson[index] = '';
  }
  if (payload.type === 'content_block_delta') {
    yield* applyBlockDelta(assembly, index, asRecord(payload.delta));
  }
  if (payload.type === 'content_block_stop') finishBlock(assembly, index, context);
  if (payload.type === 'message_delta') {
    const delta = asRecord(payload.delta);
    if (delta.stop_reason) assembly.message.stop_reason = delta.stop_reason;
    assembly.message.usage = { ...asRecord(assembly.message.usage), ...asRecord(payload.usage) };
  }
}

function* applyBlockDelta(
  assembly: StreamAssembly,
  index: number,
  delta: JsonObject,
): Generator<ChatStreamEvent> {
  const block = assembly.blocks[index] ?? {};
  if (delta.type === 'text_delta') {
    block.text = asString(block.text) + asString(delta.text);
    yield { type: 'text', text: asString(delta.text) };
  }
  if (delta.type === 'thinking_delta') {
    block.thinking = asString(block.thinking) + asString(delta.thinking);
    yield { type: 'thinking', text: asString(delta.thinking) };
  }
  if (delta.type === 'signature_delta') block.signature = delta.signature;
  if (delta.type === 'input_json_delta') {
    assembly.partialJson[index] =
      (assembly.partialJson[index] ?? '') + asString(delta.partial_json);
  }
  if (delta.type === 'citations_delta') {
    block.citations = [...asArray(block.citations), delta.citation];
  }
}

/** 區塊結束：工具內容的 JSON 片段接完後才解析。 */
function finishBlock(assembly: StreamAssembly, index: number, context: ProviderCallContext): void {
  const block = assembly.blocks[index];
  const partial = assembly.partialJson[index];
  if (!block || !partial) return;
  block.input = parseToolArguments(partial, context);
}

function streamError(payload: JsonObject, context: ProviderCallContext) {
  const error = asRecord(payload.error);
  return createProviderError(
    context,
    classifyClaudeErrorType(asString(error.type)) ?? 'PROVIDER_SERVER_ERROR',
    {
      streamError: payload,
    },
  );
}

// ===== 偵測模型 =====

/** 列出模型（含分頁），能力依 Models API 的 capabilities；已退役的模型不列。 */
async function listChatModels(apiKey: string, signal?: AbortSignal): Promise<DetectedModel[]> {
  const models: JsonObject[] = [];
  let afterId = '';
  for (;;) {
    const query = new URLSearchParams({ limit: String(MODEL_PAGE_LIMIT) });
    if (afterId) query.set('after_id', afterId);
    const page = await requestProviderJson<JsonObject>({
      provider: 'claude',
      interfaceName: 'listChatModels',
      url: `${BASE_URL}/models?${query}`,
      headers: claudeHeaders(apiKey),
      apiKey,
      signal,
      classifyError: classifyClaudeError,
    });
    models.push(...asArray(page.data).map(asRecord));
    afterId = asString(page.last_id);
    if (page.has_more !== true || !afterId) break;
  }
  return models.filter((model) => model.lifecycle !== 'retired').map(toDetectedModel);
}

function toDetectedModel(model: JsonObject): DetectedModel {
  const capabilityTree = asRecord(model.capabilities);
  const capabilities = readCapabilities(model, capabilityTree);
  const maxTokens = capabilities.maxOutputTokens;
  const params = buildCommonParams(capabilities, {
    hasMaxOutputTokens: true,
    reasoningEfforts: readEfforts(capabilityTree),
  });
  // Messages API 一定要給回應長度，把平台用的預設值標出來
  const lengthParam = params.find((param) => param.key === LLM_PARAM_KEYS.maxOutputTokens);
  if (lengthParam?.kind === 'number') {
    lengthParam.default = maxTokens ? Math.min(DEFAULT_MAX_TOKENS, maxTokens) : DEFAULT_MAX_TOKENS;
  }
  return {
    id: asString(model.id),
    displayName: asString(model.display_name) || asString(model.id),
    type: 'llm',
    capabilities,
    params,
  };
}

function readCapabilities(model: JsonObject, tree: JsonObject): LlmCapabilities {
  const support = (path: string[]): 'yes' | 'no' | 'unknown' => {
    const leaf = path.reduce<unknown>((node, key) => asRecord(node)[key], tree);
    const supported = asRecord(leaf).supported;
    if (typeof supported !== 'boolean') return 'unknown';
    return supported ? 'yes' : 'no';
  };
  return {
    imageInput: support(['image_input']),
    fileInput: support(['pdf_input']),
    webSearch: support(['server_tools', 'web_search']),
    thinking: support(['thinking']),
    // Models API 沒有工具能力的欄位，依 spec 標未知
    tools: 'unknown',
    contextWindow: toLimit(model.max_input_tokens),
    maxOutputTokens: toLimit(model.max_tokens),
  };
}

/** 思考程度的選項：有 effort 資料就列出支援的等級；只能指定思考 token 數的舊模型列低、中、高。 */
function readEfforts(tree: JsonObject): string[] {
  const effort = asRecord(tree.effort);
  const adaptive = asRecord(asRecord(asRecord(tree.thinking).types).adaptive).supported === true;
  if (adaptive && effort.supported === true) {
    return EFFORT_LEVELS.filter((level) => asRecord(effort[level]).supported === true);
  }
  return LEGACY_EFFORTS;
}

// ===== 錯誤 =====

function classifyClaudeError(status: number, body: unknown): ProviderErrorCode {
  const type = asString(asRecord(asRecord(body).error).type);
  return classifyClaudeErrorType(type) ?? classifyByStatus(status);
}

/** 依 Anthropic 的錯誤類型判斷（HTTP 狀態和串流中的 error 事件都用這個）。 */
function classifyClaudeErrorType(type: string): ProviderErrorCode | undefined {
  const codes: Record<string, ProviderErrorCode> = {
    authentication_error: 'PROVIDER_KEY_INVALID',
    billing_error: 'PROVIDER_QUOTA_EXCEEDED',
    permission_error: 'PROVIDER_REQUEST_REFUSED',
    not_found_error: 'PROVIDER_MODEL_NOT_FOUND',
    rate_limit_error: 'PROVIDER_RATE_LIMITED',
    invalid_request_error: 'PROVIDER_BAD_REQUEST',
    request_too_large: 'PROVIDER_BAD_REQUEST',
    api_error: 'PROVIDER_SERVER_ERROR',
    overloaded_error: 'PROVIDER_SERVER_ERROR',
    timeout_error: 'PROVIDER_SERVER_ERROR',
  };
  return codes[type];
}

// ===== 輔助 =====

function claudeHeaders(apiKey: string): Record<string, string> {
  return { 'x-api-key': apiKey, 'anthropic-version': API_VERSION };
}

function callContext(request: ChatRequest, interfaceName: string): ProviderCallContext {
  return { provider: 'claude', interfaceName, apiKey: request.apiKey, signal: request.signal };
}
