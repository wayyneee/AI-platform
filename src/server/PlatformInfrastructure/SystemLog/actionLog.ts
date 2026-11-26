// 「一件事一筆 log」的共用寫法：路由在事情結束時，依成功或失敗寫一筆（conventions.md 第 9 段 log 原則）。

import type { LogInput } from '../../../shared/PlatformInfrastructure/types.ts';
import { writeLog } from './logStore.ts';
import { getErrorLevel, isPlatformError } from './platformError.ts';

/** 成功時一起寫進 log 的內容（狀態、用量、key 名稱等）。 */
export type ActionLogExtra = Pick<LogInput, 'status' | 'usage' | 'keyName'>;

/**
 * 執行一件事；失敗時寫一筆 log（等級依錯誤代碼）再往外丟，最外層的錯誤攔截看到已寫過就不再寫。
 * 單純讀取本機資料時只用這個；會改變資料的事，成功後再呼叫 logSuccess。
 */
export function logFailure<Result>(
  module: string,
  action: string,
  work: () => Result,
  extra: ActionLogExtra = {},
): Result {
  const startedAt = Date.now();
  try {
    return work();
  } catch (error) {
    if (isPlatformError(error)) {
      writeLog({
        level: getErrorLevel(error.code),
        module,
        action,
        durationMs: Date.now() - startedAt,
        ...extra,
        error,
      });
    }
    throw error;
  }
}

/** 執行一件會改變資料的事：成功和失敗都寫一筆 log。 */
export function logOutcome<Result>(
  module: string,
  action: string,
  work: () => Result,
  extra: ActionLogExtra = {},
): Result {
  const startedAt = Date.now();
  const result = logFailure(module, action, work, extra);
  writeLog({ level: 'success', module, action, durationMs: Date.now() - startedAt, ...extra });
  return result;
}
