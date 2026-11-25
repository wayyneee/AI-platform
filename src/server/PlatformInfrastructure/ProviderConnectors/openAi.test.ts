// OpenAI 串接：請求格式、回應解析、串流、錯誤代碼、模型清單。回應範例依 OpenAI 官方文件（Responses API）的形狀。

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatRequest } from './connectorTypes.ts';
import { openAiConnector } from './openAi.ts';
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

function chatRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: 'gpt-5.6',
    apiKey: TEST_API_KEY,
    input: sampleConversation(),
    params: {},
    ...overrides,
  };
}

// 官方文件的回應範例：思考摘要、網頁搜尋、帶 url_citation 的回覆
const SEARCH_RESPONSE = {
  id: 'resp_1',
  object: 'response',
  status: 'completed',
  output: [
    {
      id: 'rs_1',
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: '先搜尋最新消息' }],
      encrypted_content: 'gAAAA-encrypted',
    },
    {
      type: 'web_search_call',
      id: 'ws_1',
      status: 'completed',
      action: { type: 'search', query: 'latest news about AI' },
    },
    {
      type: 'web_search_call',
      id: 'ws_2',
      status: 'completed',
      action: { type: 'open_page', url: 'https://example.com/ai' },
    },
    {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: '今天的 AI 新聞是…',
          annotations: [
            {
              type: 'url_citation',
              start_index: 0,
              end_index: 5,
              url: 'https://example.com/ai',
              title: 'AI News',
            },
          ],
        },
      ],
    },
  ],
  usage: {
    input_tokens: 75,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 1186,
    output_tokens_details: { reasoning_tokens: 1024 },
    total_tokens: 1261,
  },
};

// 官方文件的工具請求範例
const TOOL_CALL_RESPONSE = {
  id: 'resp_2',
  status: 'completed',
  output: [
    {
      id: 'fc_1',
      call_id: 'call_weather',
      type: 'function_call',
      name: 'get_weather',
      arguments: '{"location":"Paris, France"}',
    },
  ],
  usage: { input_tokens: 20, output_tokens: 8 },
};

describe('各家的對話、圖片、PDF、工具清單、工具結果、思考程度、網頁搜尋開關，正確轉成該家的格式', () => {
  it('OpenAI：對話、圖片、PDF、工具清單、工具結果轉成 Responses 的 input 項目', async () => {
    const requests = mockFetch(jsonReply(TOOL_CALL_RESPONSE));
    await openAiConnector.sendChat(chatRequest());

    const [request] = requests;
    expect(request.url).toBe('https://api.openai.com/v1/responses');
    expect(request.headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    expect(request.body).toMatchObject({
      model: 'gpt-5.6',
      store: false,
      instructions: '你是貓咪助手',
    });
    expect(request.body?.input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: '這張圖和文件在說什麼？台北天氣如何？' },
          { type: 'input_image', image_url: `data:image/png;base64,${TINY_PNG}` },
          {
            type: 'input_file',
            filename: 'cat.pdf',
            file_data: `data:application/pdf;base64,${TINY_PDF}`,
          },
        ],
      },
      { role: 'assistant', content: '我查一下天氣。' },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'get_weather',
        arguments: '{"city":"台北"}',
      },
      { type: 'function_call_output', call_id: 'call_1', output: '{"temp":25}' },
    ]);
    expect(request.body?.tools).toEqual([
      {
        type: 'function',
        name: 'get_weather',
        description: '查詢天氣',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    ]);
  });

  it('OpenAI：思考程度要求思考摘要與加密推理內容；網頁搜尋開啟時加上 web_search 工具；回應長度轉成 max_output_tokens', async () => {
    const requests = mockFetch(jsonReply(SEARCH_RESPONSE));
    await openAiConnector.sendChat(
      chatRequest({
        input: { messages: [{ role: 'user', text: 'Hi' }] },
        params: { reasoningEffort: 'high', webSearch: true, maxOutputTokens: 16, temperature: 0.5 },
      }),
    );

    const body = requests[0].body;
    expect(body?.reasoning).toEqual({ effort: 'high', summary: 'auto' });
    expect(body?.include).toEqual(['reasoning.encrypted_content']);
    expect(body?.tools).toEqual([{ type: 'web_search' }]);
    expect(body?.max_output_tokens).toBe(16);
    // spec：OpenAI 沒有溫度參數，就算帶了也不送
    expect(body).not.toHaveProperty('temperature');
  });

  it('OpenAI：沒開網頁搜尋、沒設思考程度時，不送 tools 以外的多餘欄位', async () => {
    const requests = mockFetch(jsonReply(TOOL_CALL_RESPONSE));
    await openAiConnector.sendChat(
      chatRequest({
        input: { messages: [{ role: 'user', text: 'Hi' }] },
        params: { webSearch: false },
      }),
    );
    const body = requests[0].body;
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('reasoning');
    expect(body).not.toHaveProperty('include');
  });

  it('OpenAI：同一個模型的 replay 原樣送回，換了模型就改用文字和工具請求重組', async () => {
    const replayItems = [
      { id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: 'gAAAA' },
      { type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{}' },
    ];
    const replay = { provider: 'openai' as const, model: 'gpt-5.6', data: replayItems };
    const requests = mockFetch(jsonReply(TOOL_CALL_RESPONSE), jsonReply(TOOL_CALL_RESPONSE));

    await openAiConnector.sendChat(chatRequest({ input: sampleConversation(replay) }));
    await openAiConnector.sendChat(
      chatRequest({ model: 'gpt-4.1', input: sampleConversation(replay) }),
    );

    const sameModelInput = requests[0].body?.input as unknown[];
    expect(sameModelInput.slice(1, 3)).toEqual(replayItems);
    const otherModelInput = requests[1].body?.input as unknown[];
    expect(otherModelInput[1]).toEqual({ role: 'assistant', content: '我查一下天氣。' });
  });
});

describe('各家回應中的回覆文字、思考內容、工具請求、搜尋來源、用量（含搜尋次數）正確取出，轉成統一格式', () => {
  it('OpenAI：回覆文字、思考摘要、搜尋來源、用量取出；只有 search 動作算搜尋次數', async () => {
    mockFetch(jsonReply(SEARCH_RESPONSE));
    const result = await openAiConnector.sendChat(chatRequest());

    expect(result.text).toBe('今天的 AI 新聞是…');
    expect(result.thinking).toBe('先搜尋最新消息');
    expect(result.sources).toEqual([{ url: 'https://example.com/ai', title: 'AI News' }]);
    expect(result.usage).toEqual({ inputTokens: 75, outputTokens: 1186, searchCount: 1 });
    expect(result.finishReason).toBe('stop');
    expect(result.replay.provider).toBe('openai');
    expect(result.replay.model).toBe('gpt-5.6');
    expect(result.replay.data).toHaveLength(4);
  });

  it('OpenAI：工具請求取出名稱、編號和內容，結束原因為 toolCalls', async () => {
    mockFetch(jsonReply(TOOL_CALL_RESPONSE));
    const result = await openAiConnector.sendChat(chatRequest());
    expect(result.toolCalls).toEqual([
      { id: 'call_weather', name: 'get_weather', arguments: { location: 'Paris, France' } },
    ]);
    expect(result.finishReason).toBe('toolCalls');
  });

  it('OpenAI：沒有加密內容的推理項目不放進 replay（送回去會找不到）', async () => {
    mockFetch(
      jsonReply({
        status: 'completed',
        output: [
          { id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: null },
          { type: 'message', content: [{ type: 'output_text', text: 'Hi', annotations: [] }] },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const result = await openAiConnector.sendChat(chatRequest());
    expect(result.replay.data).toEqual([
      { type: 'message', content: [{ type: 'output_text', text: 'Hi', annotations: [] }] },
    ]);
  });

  it('OpenAI：達到輸出上限時結束原因為 length', async () => {
    mockFetch(
      jsonReply({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [],
        usage: { input_tokens: 5, output_tokens: 16 },
      }),
    );
    const result = await openAiConnector.sendChat(chatRequest());
    expect(result.finishReason).toBe('length');
    expect(result.text).toBe('');
  });

  it('OpenAI：串流逐段送出回覆文字與思考內容，最後一段帶完整結果與用量', async () => {
    const requests = mockFetch(
      sseReply([
        {
          event: 'response.created',
          data: { type: 'response.created', response: { status: 'in_progress' } },
        },
        {
          event: 'response.reasoning_summary_text.delta',
          data: { type: 'response.reasoning_summary_text.delta', delta: '先搜尋' },
        },
        {
          event: 'response.output_text.delta',
          data: { type: 'response.output_text.delta', delta: '今天的 ' },
        },
        {
          event: 'response.output_text.delta',
          data: { type: 'response.output_text.delta', delta: 'AI 新聞是…' },
        },
        {
          event: 'response.completed',
          data: { type: 'response.completed', response: SEARCH_RESPONSE },
        },
      ]),
    );
    const { texts, thinkings, result } = await collectStream(
      openAiConnector.streamChat(chatRequest()),
    );

    expect(requests[0].body?.stream).toBe(true);
    expect(thinkings).toEqual(['先搜尋']);
    expect(texts).toEqual(['今天的 ', 'AI 新聞是…']);
    expect(result?.text).toBe('今天的 AI 新聞是…');
    expect(result?.usage.outputTokens).toBe(1186);
  });
});

describe('供應商的各種錯誤（key 無效、額度不足、太頻繁、拒絕、服務錯誤、連不上）對應到正確的錯誤代碼', () => {
  const cases: Array<[string, number, unknown, string]> = [
    [
      'key 無效',
      401,
      {
        error: {
          message: 'Incorrect API key provided: sk-test***7890',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      },
      'PROVIDER_KEY_INVALID',
    ],
    [
      '額度不足',
      429,
      {
        error: {
          message: 'Credit balance exhausted',
          type: 'insufficient_quota',
          code: 'credit_balance_exhausted',
        },
      },
      'PROVIDER_QUOTA_EXCEEDED',
    ],
    [
      '太頻繁',
      429,
      { error: { message: 'Rate limit reached for requests', type: 'requests', code: null } },
      'PROVIDER_RATE_LIMITED',
    ],
    [
      '拒絕',
      403,
      { error: { message: 'Country, region, or territory not supported' } },
      'PROVIDER_REQUEST_REFUSED',
    ],
    [
      '請求內容不被接受',
      400,
      { error: { message: 'Invalid image', code: 'invalid_image_url' } },
      'PROVIDER_BAD_REQUEST',
    ],
    [
      '找不到模型',
      404,
      { error: { message: 'The model does not exist', code: 'model_not_found' } },
      'PROVIDER_MODEL_NOT_FOUND',
    ],
    [
      '服務錯誤',
      503,
      { error: { type: 'service_unavailable_error', code: 'server_is_overloaded' } },
      'PROVIDER_SERVER_ERROR',
    ],
  ];

  it.each(cases)(
    'OpenAI：%s → 對應的錯誤代碼，細節保留供應商原始回應',
    async (_name, status, body, code) => {
      mockFetch(jsonReply(body, status));
      const error = await catchAsyncError(() => openAiConnector.sendChat(chatRequest()));
      expect(error.code).toBe(code);
      expect(error.details).toMatchObject({ provider: 'openai', status, body });
    },
  );

  it('OpenAI：連不上時為 PROVIDER_UNREACHABLE', async () => {
    mockFetch(networkFailure());
    const error = await catchAsyncError(() => openAiConnector.sendChat(chatRequest()));
    expect(error.code).toBe('PROVIDER_UNREACHABLE');
  });

  it('OpenAI：錯誤細節中不含 API key', async () => {
    mockFetch(jsonReply({ error: { message: `bad key ${TEST_API_KEY}` } }, 401));
    const error = await catchAsyncError(() => openAiConnector.sendChat(chatRequest()));
    expect(JSON.stringify(error.details)).not.toContain(TEST_API_KEY);
  });

  it('OpenAI：串流中途失敗時依錯誤內容對應代碼', async () => {
    mockFetch(
      sseReply([
        { data: { type: 'response.output_text.delta', delta: 'Hi' } },
        {
          data: {
            type: 'response.failed',
            response: { status: 'failed', error: { code: 'server_error', message: 'boom' } },
          },
        },
      ]),
    );
    const error = await catchAsyncError(() =>
      collectStream(openAiConnector.streamChat(chatRequest())),
    );
    expect(error.code).toBe('PROVIDER_SERVER_ERROR');
  });

  it('OpenAI：呼叫端中止時為 PROVIDER_CANCELLED', async () => {
    mockFetch(jsonReply(TOOL_CALL_RESPONSE));
    const controller = new AbortController();
    controller.abort();
    const error = await catchAsyncError(() =>
      openAiConnector.sendChat(chatRequest({ signal: controller.signal })),
    );
    expect(error.code).toBe('PROVIDER_CANCELLED');
  });
});
