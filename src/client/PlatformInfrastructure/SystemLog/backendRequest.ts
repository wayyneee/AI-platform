// 呼叫後端的介面：送出 HTTP 請求，把失敗一律轉成本專案的錯誤物件（連不上、後端回傳的錯誤、看不懂的回應）。

import type { PlatformError } from '../../../shared/PlatformInfrastructure/types.ts';
import {
  createError,
  defineErrorCodes,
  isPlatformError,
  markAsFromBackend,
  PlatformErrorObject,
} from './platformError.ts';

// 路徑為 /api/<Module>/<介面名稱>（conventions.md 第 9 段）
const API_PREFIX = '/api';
const HTTP_SERVER_ERROR = 500;

export const BackendRequestErrorCodes = defineErrorCodes({
  PLATFORM_UNREACHABLE: 'error',
  PLATFORM_RESPONSE_INVALID: 'error',
});

export interface BackendRequestOptions {
  method?: 'GET' | 'POST';
  query?: Record<string, string | undefined>;
  body?: unknown;
}

// ===== 主要流程 =====

/**
 * 呼叫後端某個模組的介面，回傳回應內容。
 * 失敗時丟出錯誤物件：連不上為 PLATFORM_UNREACHABLE、回應看不懂為 PLATFORM_RESPONSE_INVALID，
 * 後端回傳的錯誤原樣丟出（已標記為後端回傳，前端不再寫 log）。
 */
export async function requestBackend<Result>(
  module: string,
  interfaceName: string,
  options: BackendRequestOptions = {},
): Promise<Result> {
  const response = await sendRequest(module, interfaceName, options);
  const content = await readJson(response, module, interfaceName);

  if (response.ok) return content as Result;
  throw toBackendError(content, response.status, module, interfaceName);
}

// ===== 步驟 =====

async function sendRequest(
  module: string,
  interfaceName: string,
  options: BackendRequestOptions,
): Promise<Response> {
  const hasBody = options.body !== undefined;
  try {
    return await fetch(buildUrl(module, interfaceName, options.query), {
      method: options.method ?? (hasBody ? 'POST' : 'GET'),
      headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(options.body) : undefined,
    });
  } catch (cause) {
    throw createError(
      module,
      interfaceName,
      BackendRequestErrorCodes.PLATFORM_UNREACHABLE,
      `連不到後端：${describeReason(cause)}`,
    );
  }
}

async function readJson(response: Response, module: string, interfaceName: string) {
  try {
    return (await response.json()) as unknown;
  } catch (cause) {
    // 後端關掉時，前端開發伺服器的轉送會回傳 5xx 的非 JSON 內容，也算連不上
    const isBackendGone = response.status >= HTTP_SERVER_ERROR;
    throw createError(
      module,
      interfaceName,
      isBackendGone
        ? BackendRequestErrorCodes.PLATFORM_UNREACHABLE
        : BackendRequestErrorCodes.PLATFORM_RESPONSE_INVALID,
      `後端的回應不是 JSON：${describeReason(cause)}`,
      { status: response.status },
    );
  }
}

/** 後端回傳 `{ error }` 時用它；格式不對時回報看不懂的回應。 */
function toBackendError(
  content: unknown,
  status: number,
  module: string,
  interfaceName: string,
): PlatformErrorObject {
  const error = (content as { error?: unknown } | null)?.error;
  if (!isPlatformError(error)) {
    return createError(
      module,
      interfaceName,
      BackendRequestErrorCodes.PLATFORM_RESPONSE_INVALID,
      `後端回傳 HTTP ${status}，但內容不是本專案的錯誤格式`,
      { status },
    );
  }
  const backendError = new PlatformErrorObject(error as PlatformError);
  markAsFromBackend(backendError);
  return backendError;
}

// ===== 輔助 =====

function buildUrl(
  module: string,
  interfaceName: string,
  query: BackendRequestOptions['query'],
): string {
  const path = `${API_PREFIX}/${module}/${interfaceName}`;
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(name, value);
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

function describeReason(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
