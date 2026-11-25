// Grok（xAI）串接：請求格式、回應解析、串流、錯誤代碼、模型清單與價格。回應範例依 xAI 官方文件的形狀。

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatRequest } from './connectorTypes.ts';
import { grokConnector } from './grok.ts';
import {
  catchAsyncError,
  collectStream,
  jsonReply,
  mockFetch,
  networkFailure,
  sampleConversation,
  sseReply,
  TEST_API_KEY,
} from './providerTestSupport.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function chatRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: 'grok-4.7',
    apiKey: TEST_API_KEY,
    input: sampleConversation(),
    params: {},
    ...overrides,
  };
}

const SEARCH_RESPONSE = {
  id: 'resp_x1',
  object: 'response',
  model: 'grok-4.7',
  status: 'completed',
  output: [
    {
      id: 'rs_1',
      type: 'reasoning',
      status: 'completed',
      summary: [],
      content: [{ type: 'reasoning_text', text: '使用者想知道新聞' }],
      encrypted_content: 'xai-encrypted',
    },
    {
      type: 'web_search_call',
      id: 'ws_1',
      status: 'completed',
      action: { type: 'search', query: 'news' },
    },
    {
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: '最新消息如下',
          annotations: [{ type: 'url_citation', url: 'https://x.ai/news', title: 'xAI News' }],
        },
      ],
    },
  ],
  usage: {
    input_tokens: 200,
    output_tokens: 50,
    total_tokens: 250,
    output_tokens_details: { reasoning_tokens: 30 },
    num_server_side_tools_used: 3,
    server_side_tool_usage_details: { web_search_calls: 3, x_search_calls: 0 },
  },
};

describe('各家的對話、圖片、PDF、工具清單、工具結果、思考程度、網頁搜尋開關，正確轉成該家的格式', () => {
  it('Grok：送到 xAI 的 Responses API，對話、附件、工具轉成 input 項目', async () => {
    const requests = mockFetch(jsonReply(SEARCH_RESPONSE));
    await grokConnector.sendChat(chatRequest());

    const [request] = requests;
    expect(request.url).toBe('https://api.x.ai/v1/responses');
    expect(request.headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    const input = request.body?.input as Array<Record<string, unknown>>;
    expect(input.map((item) => item.type ?? item.role)).toEqual([
      'user',
      'assistant',
      'function_call',
      'function_call_output',
    ]);
    expect(request.body?.tools).toHaveLength(1);
  });

  it('Grok：溫度、回應長度、思考程度、網頁搜尋轉成 xAI 的欄位；思考程度不要求摘要', async () => {
    const requests = mockFetch(jsonReply(SEARCH_RESPONSE));
    await grokConnector.sendChat(
      chatRequest({
        input: { messages: [{ role: 'user', text: 'Hi' }] },
        params: { temperature: 0.7, maxOutputTokens: 500, reasoningEffort: 'low', webSearch: true },
      }),
    );
    expect(requests[0].body).toMatchObject({
      temperature: 0.7,
      max_output_tokens: 500,
      reasoning: { effort: 'low' },
      include: ['reasoning.encrypted_content'],
      tools: [{ type: 'web_search' }],
      store: false,
    });
  });
});

describe('各家回應中的回覆文字、思考內容、工具請求、搜尋來源、用量（含搜尋次數）正確取出，轉成統一格式', () => {
  it('Grok：思考內容取自 reasoning_text，搜尋次數用 xAI 回報的 web_search_calls', async () => {
    mockFetch(jsonReply(SEARCH_RESPONSE));
    const result = await grokConnector.sendChat(chatRequest());
    expect(result.text).toBe('最新消息如下');
    expect(result.thinking).toBe('使用者想知道新聞');
    expect(result.sources).toEqual([{ url: 'https://x.ai/news', title: 'xAI News' }]);
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 50, searchCount: 3 });
    expect(result.replay).toMatchObject({ provider: 'grok', model: 'grok-4.7' });
  });

  it('Grok：串流的 reasoning_text 增量當作思考內容', async () => {
    mockFetch(
      sseReply([
        {
          event: 'response.reasoning_text.delta',
          data: { type: 'response.reasoning_text.delta', delta: '想一下' },
        },
        {
          event: 'response.output_text.delta',
          data: { type: 'response.output_text.delta', delta: '最新消息如下' },
        },
        {
          event: 'response.completed',
          data: { type: 'response.completed', response: SEARCH_RESPONSE },
        },
      ]),
    );
    const { texts, thinkings, result } = await collectStream(
      grokConnector.streamChat(chatRequest()),
    );
    expect(thinkings).toEqual(['想一下']);
    expect(texts).toEqual(['最新消息如下']);
    expect(result?.usage.searchCount).toBe(3);
  });
});

describe('供應商的各種錯誤（key 無效、額度不足、太頻繁、拒絕、服務錯誤、連不上）對應到正確的錯誤代碼', () => {
  const cases: Array<[string, number, string]> = [
    ['key 無效', 401, 'PROVIDER_KEY_INVALID'],
    ['額度不足', 402, 'PROVIDER_QUOTA_EXCEEDED'],
    ['太頻繁', 429, 'PROVIDER_RATE_LIMITED'],
    ['拒絕', 403, 'PROVIDER_REQUEST_REFUSED'],
    ['欄位格式錯誤', 422, 'PROVIDER_BAD_REQUEST'],
    ['服務錯誤', 500, 'PROVIDER_SERVER_ERROR'],
  ];

  it.each(cases)('Grok：%s → 對應的錯誤代碼', async (_name, status, code) => {
    mockFetch(jsonReply({ code: 'error', error: 'something failed' }, status));
    const error = await catchAsyncError(() => grokConnector.sendChat(chatRequest()));
    expect(error.code).toBe(code);
  });

  it('Grok：連不上時為 PROVIDER_UNREACHABLE', async () => {
    mockFetch(networkFailure());
    const error = await catchAsyncError(() => grokConnector.sendChat(chatRequest()));
    expect(error.code).toBe('PROVIDER_UNREACHABLE');
  });
});
