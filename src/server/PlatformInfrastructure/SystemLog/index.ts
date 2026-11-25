// SystemLog 的唯一入口：錯誤物件、系統 log 的寫入與查詢、後端最外層錯誤攔截、log 的路由。

export {
  createError,
  defineErrorCodes,
  getErrorLevel,
  isPlatformError,
  toPlainError,
} from './platformError.ts';
export type { ErrorLevel, PlatformErrorObject } from './platformError.ts';
export { listLogs, openLogFiles, subscribeLogs, wasErrorLogged, writeLog } from './logStore.ts';
export type { LogFilter } from './logStore.ts';
export { handleUnexpectedError } from './errorHandling.ts';
export { registerLogRoutes } from './logRoutes.ts';
