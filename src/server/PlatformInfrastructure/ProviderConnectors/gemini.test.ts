// Gemini 串接：請求格式、回應解析、串流、錯誤代碼、模型清單與能力。回應範例依 Google Gemini API 官方文件（generateContent、models.list）的形狀。

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatRequest } from './connectorTypes.ts';
import { geminiConnector } from './gemini.ts';
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

const MODEL = 'gemini-3.6-flash';

function chatRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: MODEL,
    apiKey: TEST_API_KEY,
    input: sampleConversation(),
    params: {},
    ...overrides,
  };
}

const SEARCH_RESPONSE = {
  candidates: [
    {
      content: {
        role: 'model',
        parts: [
          { text: '使用者問天氣，需要搜尋', thought: true },
          { text: '台北今天多雲', thoughtSignature: 'sig-final' },
        ],
      },
      finishReason: 'STOP',
      groundingMetadata: {
        webSearchQueries: ['台北 天氣', '台北 天氣', ''],
        groundingChunks: [
          {
            web: {
              uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',
              title: 'cwa.gov.tw',
            },
          },
        ],
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 6, text: '台北今天多雲' },
            groundingChunkIndices: [0],
          },
        ],
      },
    },
  ],
  usageMetadata: {
    promptTokenCount: 30,
    candidatesTokenCount: 10,
    thoughtsTokenCount: 50,
    toolUsePromptTokenCount: 5,
    totalTokenCount: 95,
  },
  modelVersion: MODEL,
};

const TOOL_RESPONSE = {
  candidates: [
    {
      content: {
        role: 'model',
        parts: [
          {
            functionCall: { id: 'c1', name: 'get_weather', args: { city: '台北' } },
            thoughtSignature: 'sig-call',
          },
        ],
      },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5 },
};

describe('各家的對話、圖片、PDF、工具清單、工具結果、思考程度、網頁搜尋開關，正確轉成該家的格式', () => {
  it('Gemini：對話、圖片、PDF、工具清單、工具結果轉成 contents 與 functionDeclarations；key 放在標頭', async () => {
    const requests = mockFetch(jsonReply(TOOL_RESPONSE));
    await geminiConnector.sendChat(chatRequest());

    const [request] = requests;
    expect(request.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    );
    expect(request.url).not.toContain(TEST_API_KEY);
    expect(request.headers['x-goog-api-key']).toBe(TEST_API_KEY);
    expect(request.body?.systemInstruction).toEqual({ parts: [{ text: '你是貓咪助手' }] });
    expect(request.body?.contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: '這張圖和文件在說什麼？台北天氣如何？' },
          { inlineData: { mimeType: 'image/png', data: TINY_PNG } },
          { inlineData: { mimeType: 'application/pdf', data: TINY_PDF } },
        ],
      },
      {
        role: 'model',
        parts: [
          { text: '我查一下天氣。' },
          { functionCall: { name: 'get_weather', args: { city: '台北' }, id: 'call_1' } },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'get_weather', response: { temp: 25 }, id: 'call_1' } },
        ],
      },
    ]);
    expect(request.body?.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'get_weather',
            description: '查詢天氣',
            parametersJsonSchema: { type: 'object', properties: { city: { type: 'string' } } },
          },
        ],
      },
    ]);
  });

  it('Gemini：思考程度在 3 以後轉成 thinkingLevel、2.x 轉成 thinkingBudget，並要求思考內容；網頁搜尋加上 googleSearch；回應長度轉成 maxOutputTokens', async () => {
    const requests = mockFetch(jsonReply(SEARCH_RESPONSE));
    const input = { messages: [{ role: 'user' as const, text: 'Hi' }] };
    await geminiConnector.sendChat(
      chatRequest({
        input,
        params: { reasoningEffort: 'high', webSearch: true, maxOutputTokens: 16 },
      }),
    );
    await geminiConnector.sendChat(
      chatRequest({ model: 'gemini-2.5-pro', input, params: { reasoningEffort: 'low' } }),
    );
    expect(requests[0].body).toMatchObject({
      tools: [{ googleSearch: {} }],
      generationConfig: {
        maxOutputTokens: 16,
        thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' },
      },
    });
    expect(requests[1].body?.generationConfig).toEqual({
      thinkingConfig: { includeThoughts: true, thinkingBudget: 1024 },
    });
  });

  it('Gemini：同一個模型的 replay（含思考簽章）原樣送回；工具結果不是 JSON 物件時包成 result', async () => {
    const replay = {
      provider: 'gemini' as const,
      model: MODEL,
      data: TOOL_RESPONSE.candidates[0].content.parts,
    };
    const input = sampleConversation(replay);
    input.messages[2] = {
      role: 'tool',
      results: [{ callId: 'c1', name: 'get_weather', content: '晴天' }],
    };
    const requests = mockFetch(jsonReply(TOOL_RESPONSE));
    await geminiConnector.sendChat(chatRequest({ input }));
    const contents = requests[0].body?.contents as unknown[];
    expect(contents[1]).toEqual({
      role: 'model',
      parts: TOOL_RESPONSE.candidates[0].content.parts,
    });
    expect(contents[2]).toEqual({
      role: 'user',
      parts: [
        { functionResponse: { name: 'get_weather', response: { result: '晴天' }, id: 'c1' } },
      ],
    });
  });
});

describe('各家回應中的回覆文字、思考內容、工具請求、搜尋來源、用量（含搜尋次數）正確取出，轉成統一格式', () => {
  it('Gemini：回覆文字、思考內容、搜尋來源、用量取出；搜尋次數為不重複、非空白的搜尋字串數', async () => {
    mockFetch(jsonReply(SEARCH_RESPONSE));
    const result = await geminiConnector.sendChat(chatRequest());
    expect(result.text).toBe('台北今天多雲');
    expect(result.thinking).toBe('使用者問天氣，需要搜尋');
    expect(result.sources).toEqual([
      {
        url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',
        title: 'cwa.gov.tw',
      },
    ]);
    expect(result.usage).toEqual({ inputTokens: 35, outputTokens: 60, searchCount: 1 });
    expect(result.finishReason).toBe('stop');
    expect(result.replay).toEqual({
      provider: 'gemini',
      model: MODEL,
      data: SEARCH_RESPONSE.candidates[0].content.parts,
    });
  });

  it('Gemini：工具請求取出；沒有編號時由平台編號，送回時不帶編號', async () => {
    mockFetch(
      jsonReply(TOOL_RESPONSE),
      jsonReply({
        candidates: [
          {
            content: { parts: [{ functionCall: { name: 'get_weather', args: { city: '高雄' } } }] },
            finishReason: 'STOP',
          },
        ],
      }),
      jsonReply(SEARCH_RESPONSE),
    );
    const withId = await geminiConnector.sendChat(chatRequest());
    expect(withId.toolCalls).toEqual([
      { id: 'c1', name: 'get_weather', arguments: { city: '台北' } },
    ]);
    expect(withId.finishReason).toBe('toolCalls');

    const withoutId = await geminiConnector.sendChat(chatRequest());
    const [call] = withoutId.toolCalls;
    expect(call.id).toBe('gemini-call-0');

    const requests = mockFetch(jsonReply(SEARCH_RESPONSE));
    await geminiConnector.sendChat(
      chatRequest({
        input: {
          messages: [
            { role: 'user', text: '高雄呢？' },
            { role: 'assistant', text: '', toolCalls: [call] },
            {
              role: 'tool',
              results: [{ callId: call.id, name: 'get_weather', content: '{"temp":30}' }],
            },
          ],
        },
      }),
    );
    const contents = requests[0].body?.contents as Array<{ parts: unknown[] }>;
    expect(contents[1].parts).toEqual([
      { functionCall: { name: 'get_weather', args: { city: '高雄' } } },
    ]);
    expect(contents[2].parts).toEqual([
      { functionResponse: { name: 'get_weather', response: { temp: 30 } } },
    ]);
  });

  it('Gemini：被安全機制擋下時結束原因為 refused；達到上限時為 length', async () => {
    mockFetch(
      jsonReply({
        promptFeedback: { blockReason: 'SAFETY' },
        usageMetadata: { promptTokenCount: 5 },
      }),
      jsonReply({
        candidates: [{ content: { parts: [{ text: '台北' }] }, finishReason: 'MAX_TOKENS' }],
      }),
    );
    expect((await geminiConnector.sendChat(chatRequest())).finishReason).toBe('refused');
    expect((await geminiConnector.sendChat(chatRequest())).finishReason).toBe('length');
  });

  it('Gemini：串流逐段送出文字與思考，接起來的 parts 保留簽章，最後一段帶用量和搜尋資料', async () => {
    const requests = mockFetch(
      sseReply([
        {
          data: {
            candidates: [
              { content: { role: 'model', parts: [{ text: '想一下', thought: true }] } },
            ],
          },
        },
        { data: { candidates: [{ content: { role: 'model', parts: [{ text: '台北' }] } }] } },
        {
          data: {
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [{ text: '多雲', thoughtSignature: 'sig-final' }],
                },
              },
            ],
          },
        },
        {
          data: {
            candidates: [
              {
                content: { role: 'model', parts: [{ text: '' }] },
                finishReason: 'STOP',
                groundingMetadata: SEARCH_RESPONSE.candidates[0].groundingMetadata,
              },
            ],
            usageMetadata: SEARCH_RESPONSE.usageMetadata,
          },
        },
      ]),
    );
    const { texts, thinkings, result } = await collectStream(
      geminiConnector.streamChat(chatRequest()),
    );
    expect(requests[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse',
    );
    expect(thinkings).toEqual(['想一下']);
    expect(texts).toEqual(['台北', '多雲']);
    expect(result?.text).toBe('台北多雲');
    expect(result?.usage).toEqual({ inputTokens: 35, outputTokens: 60, searchCount: 1 });
    expect(result?.replay.data).toEqual([
      { text: '想一下', thought: true },
      { text: '台北多雲', thoughtSignature: 'sig-final' },
      { text: '' },
    ]);
  });
});

describe('供應商的各種錯誤（key 無效、額度不足、太頻繁、拒絕、服務錯誤、連不上）對應到正確的錯誤代碼', () => {
  const cases: Array<[string, number, unknown, string]> = [
    [
      'key 無效（400 + API_KEY_INVALID）',
      400,
      {
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'API_KEY_INVALID',
              domain: 'googleapis.com',
            },
          ],
        },
      },
      'PROVIDER_KEY_INVALID',
    ],
    [
      'key 無效（401）',
      401,
      { error: { code: 'authentication', message: 'invalid key' } },
      'PROVIDER_KEY_INVALID',
    ],
    [
      '額度不足（帳單未啟用）',
      400,
      { error: { code: 400, message: 'Billing disabled', status: 'FAILED_PRECONDITION' } },
      'PROVIDER_QUOTA_EXCEEDED',
    ],
    [
      '額度不足（預付額度用完）',
      402,
      { error: { code: 'payment_required', message: 'credits depleted' } },
      'PROVIDER_QUOTA_EXCEEDED',
    ],
    [
      '太頻繁',
      429,
      {
        error: { code: 429, message: 'Resource has been exhausted', status: 'RESOURCE_EXHAUSTED' },
      },
      'PROVIDER_RATE_LIMITED',
    ],
    [
      '拒絕',
      403,
      {
        error: {
          code: 403,
          message: 'Your API key was reported as leaked.',
          status: 'PERMISSION_DENIED',
        },
      },
      'PROVIDER_REQUEST_REFUSED',
    ],
    [
      '請求內容錯誤',
      400,
      { error: { code: 400, message: 'Invalid JSON payload', status: 'INVALID_ARGUMENT' } },
      'PROVIDER_BAD_REQUEST',
    ],
    [
      '找不到模型',
      404,
      { error: { code: 404, message: 'models/x is not found', status: 'NOT_FOUND' } },
      'PROVIDER_MODEL_NOT_FOUND',
    ],
    [
      '服務錯誤',
      503,
      { error: { code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' } },
      'PROVIDER_SERVER_ERROR',
    ],
  ];

  it.each(cases)('Gemini：%s → 對應的錯誤代碼', async (_name, status, body, code) => {
    mockFetch(jsonReply(body, status));
    const error = await catchAsyncError(() => geminiConnector.sendChat(chatRequest()));
    expect(error.code).toBe(code);
  });

  it('Gemini：連不上時為 PROVIDER_UNREACHABLE', async () => {
    mockFetch(networkFailure());
    const error = await catchAsyncError(() => geminiConnector.sendChat(chatRequest()));
    expect(error.code).toBe('PROVIDER_UNREACHABLE');
  });
});
