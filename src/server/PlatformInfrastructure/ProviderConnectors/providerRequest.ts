// 對供應商發請求的共用工具：送出 HTTP 請求、把失敗轉成本專案的錯誤物件、讀取 JSON、把 key 從錯誤細節中遮掉。
// 這裡不寫 log（conventions.md 第 9 段：底層工具只把錯誤完整包進錯誤物件往上丟）。

import type { ProviderId } from '../../../shared/PlatformInfrastructure/types.ts';
import {
  createError,
  defineErrorCodes,
  isPlatformError,
  type PlatformErrorObject,
} from '../SystemLog/index.ts';

const MODULE_NAME = 'PlatformInfrastructure';
const MASKED_KEY = '****';
// 錯誤細節最多保留的原始文字長度，避免整份 HTML 錯誤頁塞進 log
const MAX_RAW_TEXT_LENGTH = 2000;

export const ProviderErrorCodes = defineErrorCodes({
  PROVIDER_KEY_INVALID: 'warning',
  PROVIDER_QUOTA_EXCEEDED: 'error',
  PROVIDER_RATE_LIMITED: 'error',
  PROVIDER_REQUEST_REFUSED: 'error',
  PROVIDER_BAD_REQUEST: 'error',
  PROVIDER_MODEL_NOT_FOUND: 'warning',
  PROVIDER_SERVER_ERROR: 'error',
  PROVIDER_UNREACHABLE: 'error',
  PROVIDER_RESPONSE_INVALID: 'error',
  PROVIDER_CANCELLED: 'warning',
});

export type ProviderErrorCode = keyof typeof ProviderErrorCodes;

/** 各家依 HTTP 狀態和錯誤內容判斷錯誤代碼。 */
export type ClassifyProviderError = (status: number, body: unknown) => ProviderErrorCode;

/** 建立錯誤時需要的資訊：哪一家、哪個介面、要遮掉的 key、是否被呼叫端取消。 */
export interface ProviderCallContext {
  provider: ProviderId;
  /** 錯誤物件的介面名稱，例如 sendChat */
  interfaceName: string;
  apiKey?: string;
  signal?: AbortSignal;
}

/** 一次請求需要的資訊。 */
export interface ProviderRequestOptions extends ProviderCallContext {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** 會轉成 JSON 送出 */
  body?: unknown;
  classifyError: ClassifyProviderError;
}

// ===== 送出 =====

/** 送出請求並回傳成功的回應；連不上、被取消、HTTP 失敗都丟出錯誤物件。 */
export async function sendProviderRequest(options: ProviderRequestOptions): Promise<Response> {
  const response = await fetchOrThrow(options);
  if (response.ok) return response;
  const body = await readErrorBody(response);
  throw createProviderError(options, options.classifyError(response.status, body), {
    status: response.status,
    body,
  });
}

/** 送出請求並讀成 JSON。 */
export async function requestProviderJson<Result>(
  options: ProviderRequestOptions,
): Promise<Result> {
  const response = await sendProviderRequest(options);
  return readProviderJson<Result>(response, options);
}

/** 把回應讀成 JSON；格式不對時丟出 PROVIDER_RESPONSE_INVALID。 */
export async function readProviderJson<Result>(
  response: Response,
  context: ProviderCallContext,
): Promise<Result> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw toProviderError(error, context);
  }
  return parseProviderJson<Result>(text, context);
}

/** 解析供應商回傳的 JSON 文字；格式不對時丟出 PROVIDER_RESPONSE_INVALID。 */
export function parseProviderJson<Result>(text: string, context: ProviderCallContext): Result {
  try {
    return JSON.parse(text) as Result;
  } catch {
    throw createProviderError(context, 'PROVIDER_RESPONSE_INVALID', {
      body: text.slice(0, MAX_RAW_TEXT_LENGTH),
    });
  }
}

// ===== 建立錯誤 =====

/** 建立供應商錯誤；細節裡出現的 key 一律遮掉。 */
export function createProviderError(
  context: ProviderCallContext,
  code: ProviderErrorCode,
  details: Record<string, unknown> = {},
): PlatformErrorObject {
  const status = typeof details.status === 'number' ? `HTTP ${details.status}` : '';
  const message = [`${context.provider} ${context.interfaceName} 失敗`, status, describeCode(code)]
    .filter(Boolean)
    .join('：');
  const safeDetails = maskSecret({ provider: context.provider, ...details }, context.apiKey);
  return createError(MODULE_NAME, context.interfaceName, code, message, safeDetails);
}

/** 把讀串流、等待時發生的例外轉成錯誤物件：已是錯誤物件就原樣丟出，被取消轉成 PROVIDER_CANCELLED。 */
export function toProviderError(error: unknown, context: ProviderCallContext): unknown {
  if (isPlatformError(error)) return error;
  if (context.signal?.aborted) return createProviderError(context, 'PROVIDER_CANCELLED');
  return createProviderError(context, 'PROVIDER_UNREACHABLE', { reason: errorReason(error) });
}

/** 依常見的 HTTP 狀態判斷錯誤代碼；各家的特殊情況先自己判斷，判斷不了再交給這裡。 */
export function classifyByStatus(status: number): ProviderErrorCode {
  if (status === 401) return 'PROVIDER_KEY_INVALID';
  if (status === 402) return 'PROVIDER_QUOTA_EXCEEDED';
  if (status === 403) return 'PROVIDER_REQUEST_REFUSED';
  if (status === 404) return 'PROVIDER_MODEL_NOT_FOUND';
  if (status === 429) return 'PROVIDER_RATE_LIMITED';
  if (status >= 500 || status === 408) return 'PROVIDER_SERVER_ERROR';
  return 'PROVIDER_BAD_REQUEST';
}

// ===== 輔助 =====

async function fetchOrThrow(options: ProviderRequestOptions): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  try {
    return await fetch(options.url, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    throw toProviderError(error, options);
  }
}

/** 讀出錯誤回應的內容；是 JSON 就解析，不是就保留文字。 */
async function readErrorBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, MAX_RAW_TEXT_LENGTH);
  }
}

/** 把任何值裡出現的 key 換成遮罩（spec：key 不出現在錯誤細節中）。 */
function maskSecret<Value>(value: Value, secret: string | undefined): Value {
  if (!secret) return value;
  const json = JSON.stringify(value);
  return JSON.parse(json.split(secret).join(MASKED_KEY)) as Value;
}

function describeCode(code: ProviderErrorCode): string {
  const descriptions: Record<ProviderErrorCode, string> = {
    PROVIDER_KEY_INVALID: 'API key 無效',
    PROVIDER_QUOTA_EXCEEDED: '額度不足',
    PROVIDER_RATE_LIMITED: '請求太頻繁',
    PROVIDER_REQUEST_REFUSED: '供應商拒絕這個請求',
    PROVIDER_BAD_REQUEST: '供應商不接受這個請求的內容',
    PROVIDER_MODEL_NOT_FOUND: '找不到模型',
    PROVIDER_SERVER_ERROR: '供應商服務錯誤',
    PROVIDER_UNREACHABLE: '連不上供應商',
    PROVIDER_RESPONSE_INVALID: '供應商回應的格式無法解讀',
    PROVIDER_CANCELLED: '已取消',
  };
  return descriptions[code];
}

function errorReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause instanceof Error ? `${error.message}（${cause.message}）` : error.message;
}
