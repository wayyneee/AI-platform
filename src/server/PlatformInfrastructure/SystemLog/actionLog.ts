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
    writeFailureLog(module, action, error, startedAt, extra);
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

// ===== 要等待的事（連到外部服務） =====

/**
 * 執行一件要等待的事（例如連到供應商）：成功和失敗都寫一筆 log（conventions.md 第 9 段：會連到外部服務的操作）。
 * describeSuccess 可以從結果補上狀態、用量等內容，例如「偵測到 8 個模型」。
 */
export async function logOutcomeAsync<Result>(
  module: string,
  action: string,
  work: () => Promise<Result>,
  extra: ActionLogExtra = {},
  describeSuccess?: (result: Result) => ActionLogExtra,
): Promise<Result> {
  const startedAt = Date.now();
  let result: Result;
  try {
    result = await work();
  } catch (error) {
    writeFailureLog(module, action, error, startedAt, extra);
    throw error;
  }
  writeLog({
    level: 'success',
    module,
    action,
    durationMs: Date.now() - startedAt,
    ...extra,
    ...describeSuccess?.(result),
  });
  return result;
}

/** 執行一件要等待、但只讀資料的事：只在失敗時寫 log。 */
export async function logFailureAsync<Result>(
  module: string,
  action: string,
  work: () => Promise<Result>,
  extra: ActionLogExtra = {},
): Promise<Result> {
  const startedAt = Date.now();
  try {
    return await work();
  } catch (error) {
    writeFailureLog(module, action, error, startedAt, extra);
    throw error;
  }
}

// ===== 輔助 =====

/** 失敗的 log：等級依錯誤代碼；不是錯誤物件的意外錯誤交給最外層的錯誤攔截寫。 */
function writeFailureLog(
  module: string,
  action: string,
  error: unknown,
  startedAt: number,
  extra: ActionLogExtra,
): void {
  if (!isPlatformError(error)) return;
  writeLog({
    level: getErrorLevel(error.code),
    module,
    action,
    durationMs: Date.now() - startedAt,
    ...extra,
    error,
  });
}
