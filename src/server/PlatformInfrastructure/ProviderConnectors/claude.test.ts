// Claude 串接：請求格式、回應解析、串流、錯誤代碼、模型清單與能力。回應範例依 Anthropic 官方文件（Messages API、Models API）的形狀。

import { afterEach, describe, expect, it, vi } from 'vitest';

import { claudeConnector } from './claude.ts';
import type { ChatRequest } from './connectorTypes.ts';
import {
  catchAsyncError,
  collectStream,
  jsonReply,
  mockFetch,
  networkFailure,
  sampleConversation,
  sseReply,
  TEST_API_KEY,
  TINY_PDF,
  TINY_PNG,
} from './providerTestSupport.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const MODEL = 'claude-opus-5-5';

function chatRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: MODEL,
    apiKey: TEST_API_KEY,
    input: sampleConversation(),
    params: {},
    ...overrides,
  };
}

const SEARCH_MESSAGE = {
  id: 'msg_01',
  type: 'message',
  role: 'assistant',
  model: MODEL,
  content: [
    { type: 'thinking', thinking: '需要查最新資料', signature: 'EqQBCgIYAhIM' },
    {
      type: 'server_tool_use',
      id: 'srvtoolu_01',
      name: 'web_search',
      input: { query: 'claude news' },
    },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_01',
      content: [
        {
          type: 'web_search_result',
          url: 'https://www.anthropic.com/news',
          title: 'Anthropic News',
          encrypted_content: 'abc',
          page_age: '1 day',
        },
        {
          type: 'web_search_result',
          url: 'https://example.com/other',
          title: 'Other',
          encrypted_content: 'def',
        },
      ],
    },
    {
      type: 'text',
      text: 'Claude 最近發布了新模型',
      citations: [
        {
          type: 'web_search_result_location',
          url: 'https://www.anthropic.com/news',
          title: 'Anthropic News',
          encrypted_index: 'Eo8B',
          cited_text: 'new model',
        },
      ],
    },
  ],
  stop_reason: 'end_turn',
  usage: {
    input_tokens: 100,
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 30,
    output_tokens: 80,
    server_tool_use: { web_search_requests: 1 },
  },
};

const TOOL_MESSAGE = {
  id: 'msg_02',
  type: 'message',
  role: 'assistant',
  content: [
    { type: 'text', text: '我查一下。' },
    { type: 'tool_use', id: 'toolu_01', name: 'get_weather', input: { city: '台北' } },
  ],
  stop_reason: 'tool_use',
  usage: { input_tokens: 40, output_tokens: 12 },
};

describe('各家的對話、圖片、PDF、工具清單、工具結果、思考程度、網頁搜尋開關，正確轉成該家的格式', () => {
  it('Claude：對話、圖片、PDF、工具清單、工具結果轉成 Messages API 的區塊', async () => {
    const requests = mockFetch(jsonReply(TOOL_MESSAGE));
    await claudeConnector.sendChat(chatRequest());

    const [request] = requests;
    expect(request.url).toBe('https://api.anthropic.com/v1/messages');
    expect(request.headers['x-api-key']).toBe(TEST_API_KEY);
    expect(request.headers['anthropic-version']).toBe('2026-10-21');
    expect(request.body).toMatchObject({ model: MODEL, system: '你是貓咪助手', max_tokens: 16000 });
    expect(request.body?.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: TINY_PNG } },
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: TINY_PDF },
          },
          { type: 'text', text: '這張圖和文件在說什麼？台北天氣如何？' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我查一下天氣。' },
          { type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: '台北' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '{"temp":25}' }],
      },
    ]);
    expect(request.body?.tools).toEqual([
      {
        name: 'get_weather',
        description: '查詢天氣',
        input_schema: { type: 'object', properties: { city: { type: 'string' } } },
      },
    ]);
  });

  it('Claude：思考程度轉成自動思考（含思考摘要）與 effort；網頁搜尋加上 web_search 工具；回應長度轉成 max_tokens', async () => {
    const requests = mockFetch(jsonReply(SEARCH_MESSAGE));
    await claudeConnector.sendChat(
      chatRequest({
        input: { messages: [{ role: 'user', text: 'Hi' }] },
        params: { reasoningEffort: 'xhigh', webSearch: true, maxOutputTokens: 16 },
      }),
    );
    expect(requests[0].body).toMatchObject({
      max_tokens: 16,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'xhigh' },
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    });
    expect(requests[0].body).not.toHaveProperty('temperature');
  });

  it('Claude：只能指定思考 token 數的舊模型，思考程度轉成 budget_tokens，回應長度加上思考的量', async () => {
    const requests = mockFetch(jsonReply(TOOL_MESSAGE));
    await claudeConnector.sendChat(
      chatRequest({
        model: 'claude-haiku-4-5',
        input: { messages: [{ role: 'user', text: 'Hi' }] },
        params: { reasoningEffort: 'low', maxOutputTokens: 1000 },
      }),
    );
    expect(requests[0].body).toMatchObject({
      thinking: { type: 'enabled', budget_tokens: 2048 },
      max_tokens: 3048,
    });
    expect(requests[0].body).not.toHaveProperty('output_config');
  });

  it('Claude：同一個模型的 replay（含思考簽章）原樣送回', async () => {
    const replay = { provider: 'claude' as const, model: MODEL, data: TOOL_MESSAGE.content };
    const requests = mockFetch(jsonReply(TOOL_MESSAGE));
    await claudeConnector.sendChat(chatRequest({ input: sampleConversation(replay) }));
    const messages = requests[0].body?.messages as unknown[];
    expect(messages[1]).toEqual({ role: 'assistant', content: TOOL_MESSAGE.content });
  });
});

describe('各家回應中的回覆文字、思考內容、工具請求、搜尋來源、用量（含搜尋次數）正確取出，轉成統一格式', () => {
  it('Claude：回覆文字、思考內容、引用的搜尋來源、用量（含快取 token 與搜尋次數）取出', async () => {
    mockFetch(jsonReply(SEARCH_MESSAGE));
    const result = await claudeConnector.sendChat(chatRequest());
    expect(result.text).toBe('Claude 最近發布了新模型');
    expect(result.thinking).toBe('需要查最新資料');
    expect(result.sources).toEqual([
      { url: 'https://www.anthropic.com/news', title: 'Anthropic News' },
    ]);
    expect(result.usage).toEqual({ inputTokens: 150, outputTokens: 80, searchCount: 1 });
    expect(result.finishReason).toBe('stop');
    expect(result.replay).toEqual({
      provider: 'claude',
      model: MODEL,
      data: SEARCH_MESSAGE.content,
    });
  });

  it('Claude：工具請求取出，結束原因為 toolCalls；被拒絕時結束原因為 refused', async () => {
    mockFetch(
      jsonReply(TOOL_MESSAGE),
      jsonReply({
        type: 'message',
        content: [],
        stop_reason: 'refusal',
        usage: { input_tokens: 5, output_tokens: 0 },
      }),
    );
    const toolResult = await claudeConnector.sendChat(chatRequest());
    expect(toolResult.toolCalls).toEqual([
      { id: 'toolu_01', name: 'get_weather', arguments: { city: '台北' } },
    ]);
    expect(toolResult.finishReason).toBe('toolCalls');

    const refused = await claudeConnector.sendChat(chatRequest());
    expect(refused.finishReason).toBe('refused');
  });

  it('Claude：串流逐段送出文字與思考，組回完整的區塊（含簽章、工具內容），最後一段帶用量', async () => {
    mockFetch(
      sseReply([
        {
          event: 'message_start',
          data: {
            type: 'message_start',
            message: {
              id: 'msg_03',
              type: 'message',
              role: 'assistant',
              content: [],
              usage: { input_tokens: 25, output_tokens: 1 },
            },
          },
        },
        {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: '想想' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'signature_delta', signature: 'sig-123' },
          },
        },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
        {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'text', text: '' },
          },
        },
        { event: 'ping', data: { type: 'ping' } },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'text_delta', text: '我查' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'text_delta', text: '一下' },
          },
        },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 1 } },
        {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: 2,
            content_block: { type: 'tool_use', id: 'toolu_02', name: 'get_weather', input: {} },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 2,
            delta: { type: 'input_json_delta', partial_json: '{"city":' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 2,
            delta: { type: 'input_json_delta', partial_json: '"台北"}' },
          },
        },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 2 } },
        {
          event: 'message_delta',
          data: {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use' },
            usage: { output_tokens: 42 },
          },
        },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ]),
    );
    const { texts, thinkings, result } = await collectStream(
      claudeConnector.streamChat(chatRequest()),
    );
    expect(thinkings).toEqual(['想想']);
    expect(texts).toEqual(['我查', '一下']);
    expect(result?.toolCalls).toEqual([
      { id: 'toolu_02', name: 'get_weather', arguments: { city: '台北' } },
    ]);
    expect(result?.usage).toEqual({ inputTokens: 25, outputTokens: 42, searchCount: 0 });
    expect(result?.finishReason).toBe('toolCalls');
    expect(result?.replay.data).toEqual([
      { type: 'thinking', thinking: '想想', signature: 'sig-123' },
      { type: 'text', text: '我查一下' },
      { type: 'tool_use', id: 'toolu_02', name: 'get_weather', input: { city: '台北' } },
    ]);
  });
});

describe('供應商的各種錯誤（key 無效、額度不足、太頻繁、拒絕、服務錯誤、連不上）對應到正確的錯誤代碼', () => {
  const cases: Array<[string, number, string, string]> = [
    ['key 無效', 401, 'authentication_error', 'PROVIDER_KEY_INVALID'],
    ['額度不足', 402, 'billing_error', 'PROVIDER_QUOTA_EXCEEDED'],
    ['拒絕', 403, 'permission_error', 'PROVIDER_REQUEST_REFUSED'],
    ['找不到模型', 404, 'not_found_error', 'PROVIDER_MODEL_NOT_FOUND'],
    ['太頻繁', 429, 'rate_limit_error', 'PROVIDER_RATE_LIMITED'],
    ['請求內容錯誤', 400, 'invalid_request_error', 'PROVIDER_BAD_REQUEST'],
    ['服務錯誤', 500, 'api_error', 'PROVIDER_SERVER_ERROR'],
    ['服務過載', 529, 'overloaded_error', 'PROVIDER_SERVER_ERROR'],
  ];

  it.each(cases)('Claude：%s → 對應的錯誤代碼', async (_name, status, type, code) => {
    const body = { type: 'error', error: { type, message: 'failed' }, request_id: 'req_1' };
    mockFetch(jsonReply(body, status));
    const error = await catchAsyncError(() => claudeConnector.sendChat(chatRequest()));
    expect(error.code).toBe(code);
    expect(error.details).toMatchObject({ provider: 'claude', status, body });
  });

  it('Claude：串流中的 error 事件依錯誤類型對應', async () => {
    mockFetch(
      sseReply([
        {
          event: 'message_start',
          data: { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        },
        {
          event: 'error',
          data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
        },
      ]),
    );
    const error = await catchAsyncError(() =>
      collectStream(claudeConnector.streamChat(chatRequest())),
    );
    expect(error.code).toBe('PROVIDER_SERVER_ERROR');
  });

  it('Claude：連不上時為 PROVIDER_UNREACHABLE', async () => {
    mockFetch(networkFailure());
    const error = await catchAsyncError(() => claudeConnector.sendChat(chatRequest()));
    expect(error.code).toBe('PROVIDER_UNREACHABLE');
  });
});
