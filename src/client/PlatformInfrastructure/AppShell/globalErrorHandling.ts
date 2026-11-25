// 前端最外層的錯誤攔截：畫面中沒接住的錯誤寫進 log 並顯示錯誤訊息，不讓整個平台當掉；頁面畫面出錯的錯誤代碼也定義在這裡。

import { showError } from '../SharedComponents/index.ts';
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
  window.addEventListener('error', (event) => reportFrontendError(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => reportFrontendError(event.reason));
}

/** 把沒接住的錯誤顯示出來並寫進 log；後端回傳的錯誤後端已經寫過，只顯示不再寫。 */
export function reportFrontendError(reason: unknown): void {
  const error = toPlatformError(reason, MODULE_NAME, 'handleFrontendErrors');
  showError(error);
  if (isFromBackend(reason)) return;
  writeLog({
    level: getErrorLevel(error.code),
    module: error.module,
    action: '未預期的錯誤',
    error,
  });
}
