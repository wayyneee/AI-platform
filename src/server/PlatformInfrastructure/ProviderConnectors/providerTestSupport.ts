// 供應商串接測試用的假網路：記下送出的請求，依順序回傳準備好的回應（JSON、錯誤、SSE 串流、連不上）。只給測試使用。

import { vi } from 'vitest';

import type {
  ChatInput,
  ChatResult,
  ChatStreamEvent,
  ProviderReplay,
} from '../../../shared/PlatformInfrastructure/types.ts';

/** 測試裡看得到的一次請求。 */
export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

type FakeReply = () => Response;

// 假計時器每次快轉的時間與次數上限（最多快轉 200 秒，避免沒完成時卡住測試）
const FAKE_TIMER_STEP_MS = 1000;
const MAX_FAKE_TIMER_STEPS = 200;

/** 換掉全域 fetch：依序回傳 replies，並記下每次請求。 */
export function mockFetch(...replies: FakeReply[]): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  let index = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    requests.push({
      url,
      method: init.method ?? 'GET',
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    return reply();
  });
  return requests;
}

/** 成功的 JSON 回應。 */
export function jsonReply(body: unknown, status = 200): FakeReply {
  return () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** 檔案回應（音檔、影片）。 */
export function binaryReply(bytes: Uint8Array, contentType: string, status = 200): FakeReply {
  return () => new Response(bytes, { status, headers: { 'content-type': contentType } });
}

/**
 * 等待會查進度的生成完成：用假的計時器快轉每次等待，不用真的等。
 * 呼叫前要先 vi.useFakeTimers()；回傳完成的結果，或丟出的錯誤（用 catchAsyncError 接）。
 */
export async function settleWithFakeTimers<Result>(work: Promise<Result>): Promise<Result> {
  let isSettled = false;
  const tracked = work.finally(() => {
    isSettled = true;
  });
  // 先接住錯誤，避免快轉期間出現未處理的 rejection
  tracked.catch(() => undefined);
  for (let step = 0; step < MAX_FAKE_TIMER_STEPS && !isSettled; step += 1) {
    await vi.advanceTimersByTimeAsync(FAKE_TIMER_STEP_MS);
  }
  return tracked;
}

/** 連不上（fetch 本身丟出例外）。 */
export function networkFailure(): FakeReply {
  return () => {
    throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') });
  };
}

/** SSE 串流回應；每個項目是一個事件（物件會轉成 JSON，字串原樣送出）。 */
export function sseReply(events: Array<{ event?: string; data: unknown }>): FakeReply {
  const text = events
    .map(({ event, data }) => {
      const dataLine = `data: ${typeof data === 'string' ? data : JSON.stringify(data)}`;
      return event ? `event: ${event}\n${dataLine}\n\n` : `${dataLine}\n\n`;
    })
    .join('');
  return () => {
    const bytes = new TextEncoder().encode(text);
    // 故意切成小塊，確認跨塊的行能接起來
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let start = 0; start < bytes.length; start += 7) {
          controller.enqueue(bytes.slice(start, start + 7));
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

/** 收集串流的所有段落，並拆出逐段的文字、思考內容與最後的結果。 */
export async function collectStream(stream: AsyncGenerator<ChatStreamEvent>): Promise<{
  texts: string[];
  thinkings: string[];
  result: ChatResult | undefined;
}> {
  const texts: string[] = [];
  const thinkings: string[] = [];
  let result: ChatResult | undefined;
  for await (const event of stream) {
    if (event.type === 'text') texts.push(event.text);
    if (event.type === 'thinking') thinkings.push(event.text);
    if (event.type === 'done') result = event.result;
  }
  return { texts, thinkings, result };
}

/** 執行並回傳丟出的錯誤；沒丟出錯誤時讓測試失敗。 */
export async function catchAsyncError(
  work: () => Promise<unknown>,
): Promise<Record<string, unknown>> {
  try {
    await work();
  } catch (error) {
    return error as Record<string, unknown>;
  }
  throw new Error('預期要丟出錯誤，但沒有');
}

/**
 * 測試共用的對話：使用者附上圖片和 PDF → 模型要求使用工具 → 呼叫端送回工具結果。
 * assistantReplay 給定時，模型那一則帶上 replay（測試原樣送回）。
 */
export function sampleConversation(assistantReplay?: ProviderReplay): ChatInput {
  return {
    systemPrompt: '你是貓咪助手',
    tools: [
      {
        name: 'get_weather',
        description: '查詢天氣',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    ],
    messages: [
      {
        role: 'user',
        text: '這張圖和文件在說什麼？台北天氣如何？',
        attachments: [
          { kind: 'image', mimeType: 'image/png', data: TINY_PNG },
          { kind: 'pdf', mimeType: 'application/pdf', data: TINY_PDF, fileName: 'cat.pdf' },
        ],
      },
      {
        role: 'assistant',
        text: '我查一下天氣。',
        toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: { city: '台北' } }],
        replay: assistantReplay,
      },
      {
        role: 'tool',
        results: [{ callId: 'call_1', name: 'get_weather', content: '{"temp":25}' }],
      },
    ],
  };
}

/** 測試用的 key：用來確認 key 不會出現在錯誤細節中。 */
export const TEST_API_KEY = 'sk-test-secret-key-1234567890';
/** 一張 1x1 的 PNG（base64）。 */
export const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
/** 假的 PDF 內容（base64）。 */
export const TINY_PDF = 'JVBERi0xLjQKJcfsj6IK';
