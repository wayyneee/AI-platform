// SSE 解析：各家串流共用，確認換行格式、跨塊的行、多行 data、註解、最後沒有空行的事件都能正確切出。

import { describe, expect, it } from 'vitest';

import { readServerSentEvents, type ServerSentEvent } from './serverSentEvents.ts';

/** 把文字切成指定大小的位元組塊，模擬網路分段送達。 */
function streamOf(text: string, chunkSize: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let start = 0; start < bytes.length; start += chunkSize) {
        controller.enqueue(bytes.slice(start, start + chunkSize));
      }
      controller.close();
    },
  });
}

async function readAll(text: string, chunkSize = 3): Promise<ServerSentEvent[]> {
  const events: ServerSentEvent[] = [];
  for await (const event of readServerSentEvents(streamOf(text, chunkSize))) events.push(event);
  return events;
}

describe('各家回應中的回覆文字、思考內容、工具請求、搜尋來源、用量（含搜尋次數）正確取出，轉成統一格式', () => {
  it('串流：事件名稱與內容正確切出，中文跨塊也不會亂碼', async () => {
    const events = await readAll(
      'event: delta\ndata: {"text":"你好"}\n\nevent: done\ndata: {}\n\n',
      2,
    );
    expect(events).toEqual([
      { event: 'delta', data: '{"text":"你好"}' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('串流：CRLF 換行、多行 data、註解行、最後沒有空行的事件都能處理', async () => {
    const events = await readAll(
      ': keep-alive\r\n\r\ndata: line1\r\ndata: line2\r\n\r\ndata: [DONE]',
    );
    expect(events).toEqual([{ data: 'line1\nline2' }, { data: '[DONE]' }]);
  });
});
