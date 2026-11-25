// SystemLog 前端的唯一入口：錯誤物件、呼叫後端的介面、系統 log 的寫入、查詢與訂閱。

export {
  createError,
  defineErrorCodes,
  getErrorLevel,
  isFromBackend,
  isPlatformError,
  PlatformErrorObject,
  toPlatformError,
} from './platformError.ts';
export type { ErrorLevel } from './platformError.ts';
export { requestBackend } from './backendRequest.ts';
export type { BackendRequestOptions } from './backendRequest.ts';
export { listLogs, subscribeLogs, writeLog } from './logClient.ts';
export type { LogSubscriber } from './logClient.ts';
