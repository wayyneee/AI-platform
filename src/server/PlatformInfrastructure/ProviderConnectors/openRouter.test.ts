// OpenRouter 串接：請求格式、回應解析、串流、錯誤代碼、模型清單與價格。回應範例依 OpenRouter 官方文件（Chat Completions）的形狀。

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatRequest } from './connectorTypes.ts';
import { openRouterConnector } from './openRouter.ts';
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

const MODEL = 'anthropic/claude-sonnet-5.5';

function chatRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: MODEL,
    apiKey: TEST_API_KEY,
    input: sampleConversation(),
    params: {},
    ...overrides,
  };
}

const REASONING_DETAILS = [
  {
    type: 'reasoning.text',
    text: '先查天氣',
    signature: 'sig-abc',
    format: 'anthropic-claude-v1',
    index: 0,
  },
];

const SEARCH_COMPLETION = {
  id: 'gen-1',
  object: 'chat.completion',
  model: MODEL,
  choices: [
    {
      index: 0,
      finish_reason: 'stop',
      message: {
        role: 'assistant',
        content: '台北今天晴天',
        reasoning: '先查天氣',
        reasoning_details: REASONING_DETAILS,
        annotations: [
          {
            type: 'url_citation',
            url_citation: {
              url: 'https://weather.example.com/taipei',
              title: '台北天氣',
              content: '晴',
              start_index: 0,
              end_index: 4,
            },
          },
        ],
      },
    },
  ],
  usage: {
    prompt_tokens: 120,
    completion_tokens: 30,
    total_tokens: 150,
    cost: 0.0123,
    cost_details: { upstream_inference_cost: 0.0053, server_tool_cost: 0.007 },
    server_tool_use_details: { web_search_requests: 1 },
  },
};

const TOOL_COMPLETION = {
  id: 'gen-2',
  choices: [
    {
      index: 0,
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        reasoning_details: REASONING_DETAILS,
        tool_calls: [
          {
            id: 'call_abc',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"台北"}' },
          },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60, cost: 0.001 },
};

describe('各家的對話、圖片、PDF、工具清單、工具結果、思考程度、網頁搜尋開關，正確轉成該家的格式', () => {
  it('OpenRouter：對話、圖片、PDF、工具清單、工具結果轉成 Chat Completions 的訊息', async () => {
    const requests = mockFetch(jsonReply(TOOL_COMPLETION));
    await openRouterConnector.sendChat(chatRequest());

    const [request] = requests;
    expect(request.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(request.headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    expect(request.body?.messages).toEqual([
      { role: 'system', content: '你是貓咪助手' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '這張圖和文件在說什麼？台北天氣如何？' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${TINY_PNG}` } },
          {
            type: 'file',
            file: { filename: 'cat.pdf', file_data: `data:application/pdf;base64,${TINY_PDF}` },
          },
        ],
      },
      {
        role: 'assistant',
        content: '我查一下天氣。',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"台北"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"temp":25}' },
    ]);
    expect(request.body?.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: '查詢天氣',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      },
    ]);
  });

  it('OpenRouter：思考程度、網頁搜尋、回應長度、溫度和 OpenRouter 回報的其他參數轉成 API 欄位', async () => {
    const requests = mockFetch(jsonReply(SEARCH_COMPLETION));
    await openRouterConnector.sendChat(
      chatRequest({
        input: { messages: [{ role: 'user', text: 'Hi' }] },
        params: {
          reasoningEffort: 'medium',
          webSearch: true,
          maxOutputTokens: 1000,
          temperature: 0.8,
          topP: 0.9,
          topK: 40,
          repetitionPenalty: 1.1,
          seed: 7,
        },
      }),
    );
    expect(requests[0].body).toMatchObject({
      reasoning: { effort: 'medium' },
      tools: [{ type: 'openrouter:web_search' }],
      max_completion_tokens: 1000,
      temperature: 0.8,
      top_p: 0.9,
      top_k: 40,
      repetition_penalty: 1.1,
      seed: 7,
    });
  });

  it('OpenRouter：同一個模型的 replay（含 reasoning_details）原樣送回', async () => {
    const replayMessage = {
      role: 'assistant',
      content: null,
      tool_calls: TOOL_COMPLETION.choices[0].message.tool_calls,
      reasoning_details: REASONING_DETAILS,
    };
    const requests = mockFetch(jsonReply(TOOL_COMPLETION));
    await openRouterConnector.sendChat(
      chatRequest({
        input: sampleConversation({ provider: 'openrouter', model: MODEL, data: replayMessage }),
      }),
    );
    const messages = requests[0].body?.messages as unknown[];
    expect(messages[2]).toEqual(replayMessage);
  });
});

describe('各家回應中的回覆文字、思考內容、工具請求、搜尋來源、用量（含搜尋次數）正確取出，轉成統一格式', () => {
  it('OpenRouter：回覆文字、思考內容、搜尋來源、用量取出；搜尋次數與搜尋金額用它回報的值', async () => {
    mockFetch(jsonReply(SEARCH_COMPLETION));
    const result = await openRouterConnector.sendChat(chatRequest());
    expect(result.text).toBe('台北今天晴天');
    expect(result.thinking).toBe('先查天氣');
    expect(result.sources).toEqual([
      { url: 'https://weather.example.com/taipei', title: '台北天氣' },
    ]);
    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      searchCount: 1,
      reportedSearchCostUsd: 0.007,
    });
    expect(result.finishReason).toBe('stop');
    expect(result.replay.data).toEqual({
      role: 'assistant',
      content: '台北今天晴天',
      reasoning_details: REASONING_DETAILS,
    });
  });

  it('OpenRouter：工具請求取出，結束原因為 toolCalls', async () => {
    mockFetch(jsonReply(TOOL_COMPLETION));
    const result = await openRouterConnector.sendChat(chatRequest());
    expect(result.toolCalls).toEqual([
      { id: 'call_abc', name: 'get_weather', arguments: { city: '台北' } },
    ]);
    expect(result.finishReason).toBe('toolCalls');
    expect(result.usage.searchCount).toBe(0);
  });

  it('OpenRouter：串流逐段送出文字與思考，工具請求的片段接起來，最後一段帶用量', async () => {
    mockFetch(
      sseReply([
        {
          data: {
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  reasoning: '先查',
                  reasoning_details: [{ type: 'reasoning.text', text: '先查', index: 0 }],
                },
              },
            ],
          },
        },
        {
          data: {
            choices: [
              {
                index: 0,
                delta: {
                  reasoning: '天氣',
                  reasoning_details: [
                    { type: 'reasoning.text', text: '天氣', signature: 'sig-abc', index: 0 },
                  ],
                },
              },
            ],
          },
        },
        { data: { choices: [{ index: 0, delta: { content: '我查' } }] } },
        { data: { choices: [{ index: 0, delta: { content: '一下' } }] } },
        {
          data: {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_abc',
                      type: 'function',
                      function: { name: 'get_weather', arguments: '{"ci' },
                    },
                  ],
                },
              },
            ],
          },
        },
        {
          data: {
            choices: [
              {
                index: 0,
                delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"台北"}' } }] },
                finish_reason: 'tool_calls',
              },
            ],
          },
        },
        {
          data: {
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 50, completion_tokens: 10 },
          },
        },
        { data: '[DONE]' },
      ]),
    );
    const { texts, thinkings, result } = await collectStream(
      openRouterConnector.streamChat(chatRequest()),
    );
    expect(thinkings).toEqual(['先查', '天氣']);
    expect(texts).toEqual(['我查', '一下']);
    expect(result?.text).toBe('我查一下');
    expect(result?.toolCalls).toEqual([
      { id: 'call_abc', name: 'get_weather', arguments: { city: '台北' } },
    ]);
    expect(result?.usage).toEqual({ inputTokens: 50, outputTokens: 10, searchCount: 0 });
    expect(result?.replay.data).toMatchObject({
      reasoning_details: [
        { type: 'reasoning.text', text: '先查天氣', signature: 'sig-abc', index: 0 },
      ],
    });
  });

  it('OpenRouter：串流中的保持連線註解被略過', async () => {
    mockFetch(() => {
      const text =
        ': OPENROUTER PROCESSING\n\ndata: {"choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
      return new Response(text, { status: 200 });
    });
    const { result } = await collectStream(openRouterConnector.streamChat(chatRequest()));
    expect(result?.text).toBe('Hi');
  });
});

describe('供應商的各種錯誤（key 無效、額度不足、太頻繁、拒絕、服務錯誤、連不上）對應到正確的錯誤代碼', () => {
  const cases: Array<[string, number, string]> = [
    ['key 無效', 401, 'PROVIDER_KEY_INVALID'],
    ['額度不足', 402, 'PROVIDER_QUOTA_EXCEEDED'],
    ['拒絕（審核）', 403, 'PROVIDER_REQUEST_REFUSED'],
    ['逾時', 408, 'PROVIDER_SERVER_ERROR'],
    ['太頻繁', 429, 'PROVIDER_RATE_LIMITED'],
    ['模型無法使用', 502, 'PROVIDER_SERVER_ERROR'],
    ['沒有可用的供應商', 503, 'PROVIDER_SERVER_ERROR'],
    ['請求內容錯誤', 400, 'PROVIDER_BAD_REQUEST'],
  ];

  it.each(cases)('OpenRouter：%s → 對應的錯誤代碼', async (_name, status, code) => {
    const body = {
      error: { code: status, message: 'failed', metadata: { provider_name: 'Anthropic' } },
    };
    mockFetch(jsonReply(body, status));
    const error = await catchAsyncError(() => openRouterConnector.sendChat(chatRequest()));
    expect(error.code).toBe(code);
    expect(error.details).toMatchObject({ status, body });
  });

  it('OpenRouter：HTTP 200 但內容是錯誤時，依錯誤內容的 code 對應', async () => {
    mockFetch(jsonReply({ error: { code: 402, message: 'Insufficient credits' } }));
    const error = await catchAsyncError(() => openRouterConnector.sendChat(chatRequest()));
    expect(error.code).toBe('PROVIDER_QUOTA_EXCEEDED');
  });

  it('OpenRouter：串流中途的錯誤事件對應到錯誤代碼', async () => {
    mockFetch(
      sseReply([
        { data: { choices: [{ index: 0, delta: { content: 'Hi' } }] } },
        {
          data: {
            error: {
              code: 429,
              message: 'Rate limit exceeded',
              metadata: { error_type: 'rate_limit_exceeded' },
            },
            choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }],
          },
        },
      ]),
    );
    const error = await catchAsyncError(() =>
      collectStream(openRouterConnector.streamChat(chatRequest())),
    );
    expect(error.code).toBe('PROVIDER_RATE_LIMITED');
  });

  it('OpenRouter：連不上時為 PROVIDER_UNREACHABLE', async () => {
    mockFetch(networkFailure());
    const error = await catchAsyncError(() => openRouterConnector.sendChat(chatRequest()));
    expect(error.code).toBe('PROVIDER_UNREACHABLE');
  });
});
