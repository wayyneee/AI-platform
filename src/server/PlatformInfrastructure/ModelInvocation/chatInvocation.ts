// LLM 的呼叫：一般呼叫取得完整結果、串流逐段送出回覆文字與思考內容，呼叫完記錄用量。
// 工具由呼叫端執行（spec 重要決定）：模型要求使用工具時只回傳請求，呼叫端執行完再呼叫一次送回結果，
// 每來回一次就是一次呼叫，各自一筆 log、各自記錄用量。

import type {
  ChatInvocation,
  ChatInvocationResult,
  ChatInvocationStreamEvent,
} from '../../../shared/PlatformInfrastructure/types.ts';
import type { ChatRequest } from '../ProviderConnectors/index.ts';
import { ProviderErrorCodes } from '../ProviderConnectors/index.ts';
import { createError } from '../SystemLog/index.ts';
import {
  prepareInvocation,
  requireChatConnector,
  type PreparedInvocation,
} from './invocationSetup.ts';
import { startInvocationLog } from './invocationLog.ts';

const MODULE_NAME = 'PlatformInfrastructure';

// ===== 一般呼叫 =====

/**
 * 呼叫 LLM 並取得完整結果（回覆文字、思考內容、工具請求、搜尋來源、供應商原始內容、用量）與花費。
 * 失敗時丟出錯誤物件，例如 MODEL_NOT_FOUND、MODEL_KEY_MISSING、INVOCATION_PARAM_INVALID、PROVIDER_ 開頭的供應商錯誤；不自動重試。
 */
export async function invokeModel(request: ChatInvocation): Promise<ChatInvocationResult> {
  const interfaceName = 'invokeModel';
  const log = startInvocationLog(request.callerModule, '呼叫模型', request.modelId);
  let prepared: PreparedInvocation;
  let result: ChatInvocationResult['result'];
  try {
    prepared = await prepareInvocation(request.modelId, request.params, 'chat', interfaceName);
    log.setTarget(prepared);
    const connector = requireChatConnector(prepared, interfaceName);
    result = await connector.sendChat(toChatRequest(prepared, request));
  } catch (error) {
    throw log.fail(error, interfaceName);
  }
  const cost = log.succeed(prepared, result.usage);
  return { result, cost };
}

// ===== 串流 =====

/**
 * 串流呼叫 LLM：逐段送出回覆文字與思考內容，最後一段帶完整結果與花費。
 * 用 request.signal 中止，或不再讀取（例如 break）都算中止：不記錄用量，log 為警告。
 * 失敗時丟出的錯誤同 invokeModel；用 signal 中止時丟出 PROVIDER_CANCELLED。
 */
export async function* streamModel(
  request: ChatInvocation,
): AsyncGenerator<ChatInvocationStreamEvent> {
  const interfaceName = 'streamModel';
  const log = startInvocationLog(request.callerModule, '串流呼叫模型', request.modelId);
  let isEnded = false;
  try {
    const prepared = await prepareInvocation(
      request.modelId,
      request.params,
      'chat',
      interfaceName,
    );
    log.setTarget(prepared);
    const connector = requireChatConnector(prepared, interfaceName);
    for await (const event of connector.streamChat(toChatRequest(prepared, request))) {
      if (event.type !== 'done') {
        yield event;
        continue;
      }
      isEnded = true;
      const cost = log.succeed(prepared, event.result.usage);
      yield { type: 'done', result: event.result, cost };
    }
    if (!isEnded) throw incompleteStreamError(interfaceName);
  } catch (error) {
    isEnded = true;
    throw log.fail(error, interfaceName);
  } finally {
    // 走到這裡還沒結束，代表呼叫端不再讀取串流，視為中止
    if (!isEnded) log.stop();
  }
}

// ===== 輔助 =====

/** 換成 ProviderConnectors 的請求；完整的 key 只在這裡交給供應商串接。 */
function toChatRequest(prepared: PreparedInvocation, request: ChatInvocation): ChatRequest {
  return {
    model: prepared.model.modelId,
    apiKey: prepared.connection.connection.apiKey ?? '',
    input: request.input,
    params: prepared.params,
    signal: request.signal,
  };
}

/** 供應商的串流結束了卻沒有完整結果：當成回應格式無法解讀。 */
function incompleteStreamError(interfaceName: string) {
  return createError(
    MODULE_NAME,
    interfaceName,
    ProviderErrorCodes.PROVIDER_RESPONSE_INVALID,
    '串流已經結束，但沒有收到完整的結果',
  );
}
