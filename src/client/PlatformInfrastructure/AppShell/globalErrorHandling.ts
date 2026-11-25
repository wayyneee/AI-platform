// 前端最外層的錯誤攔截：畫面中沒接住的錯誤寫進 log，不讓整個平台當掉；頁面畫面出錯的錯誤代碼也定義在這裡。

import {
  defineErrorCodes,
  getErrorLevel,
  isFromBackend,
  toPlatformError,
  writeLog,
} from '../SystemLog/index.ts';

const MODULE_NAME = 'PlatformInfrastructure';

export const AppShellErrorCodes = defineErrorCodes({
  PLATFORM_PAGE_RENDER_FAILED: 'error',
});

let isHandlerInstalled = false;

/** 掛上前端最外層的錯誤攔截；由外殼啟動時呼叫一次。 */
export function handleFrontendErrors(): void {
  if (isHandlerInstalled) return;
  isHandlerInstalled = true;
  window.addEventListener('error', (event) => logFrontendError(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => logFrontendError(event.reason));
}

/** 把沒接住的錯誤寫進 log；後端回傳的錯誤後端已經寫過，不再寫。 */
export function logFrontendError(reason: unknown): void {
  if (isFromBackend(reason)) return;
  const error = toPlatformError(reason, MODULE_NAME, 'handleFrontendErrors');
  writeLog({
    level: getErrorLevel(error.code),
    module: error.module,
    action: '未預期的錯誤',
    error,
  });
}
