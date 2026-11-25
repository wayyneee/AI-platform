// 讀取供應商的串流回應（SSE）：把位元組切成一個個事件，交給各家的串接自己解讀內容。

/** 一個 SSE 事件；event 沒寫時為 undefined。 */
export interface ServerSentEvent {
  event?: string;
  data: string;
}

const LINE_BREAK = /\r\n|\r|\n/;

/** 逐一讀出 SSE 事件；註解行（以 : 開頭，例如 OpenRouter 的保持連線訊息）略過。 */
export async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerSentEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  let pending = emptyEvent();

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(LINE_BREAK);
    // 最後一段可能還沒收完，留到下一塊
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const finished = applyLine(pending, line);
      if (!finished) continue;
      yield finished;
      pending = emptyEvent();
    }
  }

  buffer += decoder.decode();
  if (buffer) applyLine(pending, buffer);
  const last = toEvent(pending);
  if (last) yield last;
}

// ===== 輔助 =====

interface PendingEvent {
  event?: string;
  dataLines: string[];
}

function emptyEvent(): PendingEvent {
  return { dataLines: [] };
}

/** 套用一行；遇到空行代表一個事件結束，回傳那個事件。 */
function applyLine(pending: PendingEvent, line: string): ServerSentEvent | undefined {
  if (line === '') return toEvent(pending);
  if (line.startsWith(':')) return undefined;
  const colon = line.indexOf(':');
  const field = colon === -1 ? line : line.slice(0, colon);
  // SSE 規格：冒號後面的第一個空白不算內容
  const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
  if (field === 'event') pending.event = value;
  if (field === 'data') pending.dataLines.push(value);
  return undefined;
}

function toEvent(pending: PendingEvent): ServerSentEvent | undefined {
  if (pending.dataLines.length === 0) return undefined;
  return { event: pending.event, data: pending.dataLines.join('\n') };
}
