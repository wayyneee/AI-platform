// 後端最外層的錯誤攔截：路由丟出的錯誤一律轉成本專案的錯誤格式回應，還沒寫過 log 的補寫一筆；
// 未預期的錯誤只寫 log、不讓平台停止。

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { PlatformError } from '../../../shared/PlatformInfrastructure/types.ts';
import { writeLog, wasErrorLogged } from './logStore.ts';
import {
  createError,
  defineErrorCodes,
  getErrorLevel,
  isPlatformError,
  toPlainError,
} from './platformError.ts';

const MODULE_NAME = 'PlatformInfrastructure';
const HANDLER_INTERFACE = 'handleUnexpectedError';
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
// 路徑為 /api/<Module>/<介面名稱>（conventions.md 第 9 段）
const API_PATH_PATTERN = /^\/api\/([^/?]+)\/([^/?]+)/;

export const SystemErrorCodes = defineErrorCodes({
  PLATFORM_UNEXPECTED_ERROR: 'error',
  PLATFORM_REQUEST_INVALID: 'warning',
  PLATFORM_ROUTE_NOT_FOUND: 'warning',
});

let isProcessHandlerRegistered = false;

// ===== 主要流程 =====

/** 掛上後端最外層的錯誤攔截；要在登記各模組的路由之前呼叫。 */
export function handleUnexpectedError(server: FastifyInstance): void {
  server.setErrorHandler(replyWithPlatformError);
  server.setNotFoundHandler(replyRouteNotFound);
  registerProcessHandlers();
}

/** 把程式中沒接住的錯誤寫進 log，平台繼續執行。 */
export function logUncaughtError(reason: unknown): void {
  const error = createError(
    MODULE_NAME,
    HANDLER_INTERFACE,
    SystemErrorCodes.PLATFORM_UNEXPECTED_ERROR,
    `程式中有沒接住的錯誤：${describeReason(reason)}`,
    describeStack(reason),
  );
  writeLog({ level: 'error', module: MODULE_NAME, action: '未預期的錯誤', error });
}

// ===== 路由錯誤 =====

function replyWithPlatformError(
  thrown: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const route = readRoute(request);
  const isUnexpected = !isPlatformError(thrown) && !isRequestError(thrown);
  const error = toPlatformError(thrown, route);

  if (!wasErrorLogged(thrown)) {
    // 未預期的錯誤在 log 裡附上程式堆疊方便除錯，回應不帶（spec 規則）
    const loggedError = isUnexpected
      ? { ...toPlainError(error), details: describeStack(thrown) }
      : error;
    writeLog({
      level: getErrorLevel(error.code),
      module: route.module,
      action: `處理請求：${request.method} ${request.url}`,
      error: loggedError,
    });
  }

  const status = getErrorLevel(error.code) === 'warning' ? HTTP_BAD_REQUEST : HTTP_SERVER_ERROR;
  reply.status(status).send({ error: toPlainError(error) });
}

function replyRouteNotFound(request: FastifyRequest, reply: FastifyReply): void {
  const route = readRoute(request);
  const error = createError(
    route.module,
    route.interfaceName,
    SystemErrorCodes.PLATFORM_ROUTE_NOT_FOUND,
    `找不到這個路徑：${request.method} ${request.url}`,
  );
  reply.status(HTTP_NOT_FOUND).send({ error: toPlainError(error) });
}

/** 把任何丟出來的東西轉成錯誤物件：已經是就直接用，請求格式錯誤為警告，其他都算未預期的錯誤。 */
function toPlatformError(thrown: unknown, route: RouteName): PlatformError {
  if (isPlatformError(thrown)) return thrown;
  if (isRequestError(thrown)) {
    return createError(
      route.module,
      route.interfaceName,
      SystemErrorCodes.PLATFORM_REQUEST_INVALID,
      `請求格式不正確：${thrown.message}`,
      { fastifyCode: thrown.code },
    );
  }
  return createError(
    route.module,
    route.interfaceName,
    SystemErrorCodes.PLATFORM_UNEXPECTED_ERROR,
    `處理請求時發生未預期的錯誤：${describeReason(thrown)}`,
  );
}

// ===== 輔助 =====

interface RouteName {
  module: string;
  interfaceName: string;
}

/** 從網址讀出模組和介面名稱，讓錯誤標明出處；不是 /api/ 開頭時算在本模組。 */
function readRoute(request: FastifyRequest): RouteName {
  const match = API_PATH_PATTERN.exec(request.url);
  if (!match) return { module: MODULE_NAME, interfaceName: HANDLER_INTERFACE };
  return { module: match[1], interfaceName: match[2] };
}

/** Fastify 判定請求本身有問題（格式驗證失敗、JSON 壞掉、內容太大）時，錯誤帶 4xx 狀態。 */
function isRequestError(thrown: unknown): thrown is FastifyError {
  if (!(thrown instanceof Error)) return false;
  const statusCode = (thrown as FastifyError).statusCode;
  return (
    statusCode !== undefined && statusCode >= HTTP_BAD_REQUEST && statusCode < HTTP_SERVER_ERROR
  );
}

function describeReason(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function describeStack(reason: unknown): { errorName?: string; stack?: string } {
  if (!(reason instanceof Error)) return {};
  return { errorName: reason.name, stack: reason.stack };
}

/** 程式中沒接住的錯誤也寫進 log；掛上之後 Node 不會因此結束程式。 */
function registerProcessHandlers(): void {
  if (isProcessHandlerRegistered) return;
  isProcessHandlerRegistered = true;
  process.on('uncaughtException', logUncaughtError);
  process.on('unhandledRejection', logUncaughtError);
}
