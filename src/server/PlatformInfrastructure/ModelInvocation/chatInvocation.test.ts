// LLM 的呼叫與串流：逐段送出、中止不記用量、不依能力擋下、工具來回、搜尋來源、一件事一筆 log、記錄用量失敗照常回傳。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ChatInvocation,
  ChatInvocationStreamEvent,
  ChatResult,
  ChatStreamEvent,
  SavedModel,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { addApiKey, deleteApiKey, updateModelKey } from '../ModelRegistry/index.ts';
import { createError } from '../SystemLog/index.ts';
import { getUsageStats, recordUsage } from '../UsageAndCost/index.ts';
import { invokeModel, streamModel } from './chatInvocation.ts';
import {
  CALLER,
  CHAT_RESULT,
  fakeChat,
  IMAGE_MODEL,
  LLM_MODEL,
  providerError,
  saveCloudModel,
  setUpInvocationTest,
  startLogWatch,
  tearDownInvocationTest,
} from './invocationTestSupport.ts';

vi.mock('../ProviderConnectors/index.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('./invocationTestSupport.ts')).fakeProviderConnectors,
}));

// 換成可以讓它失敗一次的版本；平常照原本的方式記錄
vi.mock('../UsageAndCost/index.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../UsageAndCost/index.ts')>();
  return { ...original, recordUsage: vi.fn(original.recordUsage) };
});

let model: SavedModel;

beforeEach(async () => {
  setUpInvocationTest();
  model = await saveCloudModel(LLM_MODEL);
  // 新增模型時的測試也會送一則對話，不算在各個測試裡
  fakeChat.sendChat.mockClear();
});

afterEach(() => {
  tearDownInvocationTest();
});

// ===== 輔助 =====

function chatRequest(overrides: Partial<ChatInvocation> = {}): ChatInvocation {
  return {
    callerModule: CALLER,
    modelId: model.id,
    params: {},
    input: { messages: [{ role: 'user', text: '你好' }] },
    ...overrides,
  };
}

/** 這組 key 目前記下的輸入 token 總數。 */
function recordedInputTokens(keyId = model.keyId ?? ''): number {
  return getUsageStats({ keyId, unit: 'hour' }).stats?.totals.inputTokens ?? 0;
}

async function collect(stream: AsyncGenerator<ChatInvocationStreamEvent>) {
  const events: ChatInvocationStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function rejectionOf(promise: Promise<unknown>) {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

// ===== 串流 =====

describe('串流', () => {
  it('串流逐段送出回覆文字與思考內容，最後一段帶用量與花費', async () => {
    fakeChat.streamChat.mockImplementation(async function* () {
      yield { type: 'thinking', text: '想一下' } as ChatStreamEvent;
      yield { type: 'text', text: '你' } as ChatStreamEvent;
      yield { type: 'text', text: '好' } as ChatStreamEvent;
      yield { type: 'done', result: CHAT_RESULT } as ChatStreamEvent;
    });
    const events = await collect(streamModel(chatRequest()));
    expect(events.map((event) => event.type)).toEqual(['thinking', 'text', 'text', 'done']);
    const last = events.at(-1);
    // 輸入 100 萬 token × $1 + 輸出 50 萬 token × $2
    expect(last).toMatchObject({ result: { usage: CHAT_RESULT.usage }, cost: { costUsd: 2 } });
    expect(recordedInputTokens()).toBe(1_000_000);
  });

  it('呼叫端用 signal 中止串流時不記錄用量，log 為警告', async () => {
    const controller = new AbortController();
    fakeChat.streamChat.mockImplementation(async function* () {
      yield { type: 'text', text: '你' } as ChatStreamEvent;
      controller.abort();
      throw providerError('PROVIDER_CANCELLED', 'streamChat');
    });
    const logs = startLogWatch();
    const error = await rejectionOf(
      collect(streamModel(chatRequest({ signal: controller.signal }))),
    );
    expect(error).toMatchObject({ code: 'PROVIDER_CANCELLED' });
    expect(recordedInputTokens()).toBe(0);
    expect(logs()).toMatchObject([{ level: 'warning', error: { code: 'PROVIDER_CANCELLED' } }]);
  });

  it('呼叫端不再讀取串流時視為中止：不記錄用量，log 為「已中止」', async () => {
    fakeChat.streamChat.mockImplementation(async function* () {
      yield { type: 'text', text: '你' } as ChatStreamEvent;
      yield { type: 'done', result: CHAT_RESULT } as ChatStreamEvent;
    });
    const logs = startLogWatch();
    for await (const event of streamModel(chatRequest())) {
      if (event.type === 'text') break;
    }
    expect(recordedInputTokens()).toBe(0);
    expect(logs()).toMatchObject([{ level: 'warning', status: '已中止' }]);
  });

  it('一次串流剛好一筆 log', async () => {
    const logs = startLogWatch();
    await collect(streamModel(chatRequest()));
    expect(logs()).toHaveLength(1);
    expect(logs()[0]).toMatchObject({ level: 'success', action: expect.stringContaining('串流') });
  });
});

// ===== 參數與能力 =====

describe('參數與能力', () => {
  it('參數超出範圍時回報錯誤，不送給供應商', async () => {
    const error = await rejectionOf(invokeModel(chatRequest({ params: { temperature: 3 } })));
    expect(error).toMatchObject({ code: 'INVOCATION_PARAM_INVALID', interfaceName: 'invokeModel' });
    expect(fakeChat.sendChat).not.toHaveBeenCalled();
  });

  it('不在定義中的參數略過，沒填的用預設值', async () => {
    await invokeModel(chatRequest({ params: { temperature: 0.5, topK: 40 } }));
    expect(fakeChat.sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { maxOutputTokens: 1000, temperature: 0.5, webSearch: false },
      }),
    );
  });

  it('本模組不依能力擋下呼叫：能力標「不支援」的模型照樣送出圖片、工具、搜尋', async () => {
    const input = {
      messages: [
        {
          role: 'user' as const,
          text: '看圖',
          attachments: [{ kind: 'image' as const, mimeType: 'image/png', data: 'AAAA' }],
        },
      ],
      tools: [{ name: 'saveMemory', description: '記住', parameters: { type: 'object' } }],
    };
    await invokeModel(chatRequest({ input, params: { webSearch: true } }));
    expect(fakeChat.sendChat).toHaveBeenCalledWith(
      expect.objectContaining({ input, params: expect.objectContaining({ webSearch: true }) }),
    );
  });

  it('供應商拒絕時依錯誤格式回報，log 為錯誤', async () => {
    fakeChat.sendChat.mockRejectedValueOnce(providerError('PROVIDER_REQUEST_REFUSED'));
    const logs = startLogWatch();
    const error = await rejectionOf(invokeModel(chatRequest()));
    expect(error).toMatchObject({
      module: 'PlatformInfrastructure',
      code: 'PROVIDER_REQUEST_REFUSED',
    });
    expect(logs()).toMatchObject([{ level: 'error', error: { code: 'PROVIDER_REQUEST_REFUSED' } }]);
  });

  it('圖片模型不能用 invokeModel 呼叫', async () => {
    const imageModel = await saveCloudModel(IMAGE_MODEL, 'grok');
    const error = await rejectionOf(invokeModel(chatRequest({ modelId: imageModel.id })));
    expect(error).toMatchObject({ code: 'INVOCATION_MODEL_TYPE_MISMATCH' });
  });

  it('刪除 key 後呼叫回報錯誤；重新選 key 後可以正常呼叫', async () => {
    deleteApiKey(model.keyId ?? '');
    const error = await rejectionOf(invokeModel(chatRequest()));
    expect(error).toMatchObject({ code: 'MODEL_KEY_MISSING' });

    const newKey = addApiKey({
      provider: 'openrouter',
      name: '新的',
      keyValue: 'sk-new-key-123456',
    });
    updateModelKey(model.id, newKey.id);
    const { result } = await invokeModel(chatRequest());
    expect(result.text).toBe(CHAT_RESULT.text);
    expect(fakeChat.sendChat).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: 'sk-new-key-123456' }),
    );
  });
});

// ===== 工具與搜尋 =====

describe('工具與搜尋', () => {
  it('模型要求使用工具時不執行，回傳工具名稱和內容；送回工具結果後模型能接著回覆', async () => {
    const toolCall = { id: 'call-1', name: 'saveMemory', arguments: { text: '喜歡貓' } };
    const askTool: ChatResult = {
      ...CHAT_RESULT,
      text: '',
      toolCalls: [toolCall],
      finishReason: 'toolCalls',
    };
    fakeChat.sendChat.mockResolvedValueOnce(askTool);
    const logs = startLogWatch();

    const first = await invokeModel(chatRequest());
    expect(first.result.toolCalls).toEqual([toolCall]);

    const second = await invokeModel(
      chatRequest({
        input: {
          messages: [
            { role: 'user', text: '記住我喜歡貓' },
            { role: 'assistant', text: '', toolCalls: [toolCall], replay: first.result.replay },
            {
              role: 'tool',
              results: [{ callId: 'call-1', name: 'saveMemory', content: '已記住' }],
            },
          ],
        },
      }),
    );
    expect(second.result.text).toBe(CHAT_RESULT.text);
    // 供應商原始內容跟著那則回覆原樣送回
    const sentMessages = fakeChat.sendChat.mock.calls.at(-1)?.[0].input.messages;
    expect(sentMessages?.[1]).toMatchObject({ replay: CHAT_RESULT.replay });
    // 工具每來回一次各一筆 log、各自記錄用量
    expect(logs()).toHaveLength(2);
    expect(recordedInputTokens()).toBe(2_000_000);
  });

  it('開啟網頁搜尋時，回傳搜尋來源', async () => {
    const sources = [{ url: 'https://example.com/news', title: '新聞' }];
    fakeChat.sendChat.mockResolvedValueOnce({
      ...CHAT_RESULT,
      sources,
      usage: { ...CHAT_RESULT.usage, searchCount: 1 },
    });
    const { result } = await invokeModel(chatRequest({ params: { webSearch: true } }));
    expect(result.sources).toEqual(sources);
  });
});

// ===== log 與用量 =====

describe('log 與用量', () => {
  it('一次呼叫剛好一筆 log，模組寫成「呼叫的模組 → PlatformInfrastructure」，只記 key 的名稱', async () => {
    const logs = startLogWatch();
    await invokeModel(chatRequest());
    expect(logs()).toEqual([
      expect.objectContaining({
        level: 'success',
        module: 'ChatRoom → PlatformInfrastructure',
        action: '呼叫模型：DeepSeek V3（OpenRouter，LLM）',
        keyName: '個人（OpenRouter）',
        usage: '輸入 1000000 token、輸出 500000 token，約 US$2.0000',
      }),
    ]);
    expect(JSON.stringify(logs())).not.toContain('sk-test');
  });

  it('準備階段失敗（找不到模型）也剛好一筆 log', async () => {
    const logs = startLogWatch();
    const error = await rejectionOf(invokeModel(chatRequest({ modelId: 'missing' })));
    expect(error).toMatchObject({ code: 'MODEL_NOT_FOUND' });
    expect(logs()).toMatchObject([{ level: 'warning', action: '呼叫模型：編號 missing 的模型' }]);
  });

  it('已取得結果但記錄用量失敗時，結果照常回傳，log 為錯誤並註明', async () => {
    vi.mocked(recordUsage).mockImplementationOnce(() => {
      throw createError(
        'PlatformInfrastructure',
        'recordUsage',
        'DATABASE_QUERY_FAILED',
        '寫不進去',
      );
    });
    const logs = startLogWatch();
    const { result, cost } = await invokeModel(chatRequest());
    expect(result.text).toBe(CHAT_RESULT.text);
    expect(cost).toBeNull();
    expect(logs()).toMatchObject([
      {
        level: 'error',
        status: '已取得結果，但用量記錄失敗',
        error: { code: 'DATABASE_QUERY_FAILED' },
      },
    ]);
  });
});
