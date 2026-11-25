// 前端的錯誤物件：建立、判斷本專案格式的錯誤，記住每個錯誤代碼的等級，並記住哪些錯誤是後端回傳的。

import type { LogLevel, PlatformError } from '../../../shared/PlatformInfrastructure/types.ts';

/** 錯誤代碼的等級：使用者造成的失敗為警告，系統或外部造成的為錯誤。 */
export type ErrorLevel = Exclude<LogLevel, 'success'>;

const DEFAULT_ERROR_LEVEL: ErrorLevel = 'error';

// ===== 錯誤代碼的等級 =====

const errorLevels = new Map<string, ErrorLevel>();

/**
 * 登記一組錯誤代碼和它們的等級，回傳代碼本身方便當常數使用。
 * 錯誤代碼全平台不重複：同一個代碼登記第二次時直接丟出錯誤，讓問題在啟動時就出現。
 */
export function defineErrorCodes<Codes extends Record<string, ErrorLevel>>(
  levels: Codes,
): { [Code in keyof Codes]: Code } {
  const codes: Record<string, string> = {};
  for (const [code, level] of Object.entries(levels)) {
    if (errorLevels.has(code)) {
      throw new Error(`錯誤代碼重複登記：${code}`);
    }
    errorLevels.set(code, level);
    codes[code] = code;
  }
  return codes as { [Code in keyof Codes]: Code };
}

/** 查詢前端登記的錯誤代碼等級；沒有登記過的代碼視為錯誤。 */
export function getErrorLevel(code: string): ErrorLevel {
  return errorLevels.get(code) ?? DEFAULT_ERROR_LEVEL;
}

// ===== 建立與判斷 =====

/** 可以 throw 的錯誤物件；轉成 JSON 時只留錯誤格式的欄位，不帶程式堆疊。 */
export class PlatformErrorObject extends Error implements PlatformError {
  module: string;
  interfaceName: string;
  code: string;
  details?: unknown;

  constructor(fields: PlatformError) {
    super(fields.message);
    this.name = 'PlatformError';
    this.module = fields.module;
    this.interfaceName = fields.interfaceName;
    this.code = fields.code;
    this.details = fields.details;
  }

  toJSON(): PlatformError {
    return toPlainError(this);
  }
}

/** 建立一個錯誤物件。 */
export function createError(
  module: string,
  interfaceName: string,
  code: string,
  message: string,
  details?: unknown,
): PlatformErrorObject {
  return new PlatformErrorObject({ module, interfaceName, code, message, details });
}

export const UnexpectedErrorCodes = defineErrorCodes({
  PLATFORM_FRONTEND_UNEXPECTED_ERROR: 'error',
});

/**
 * 把任何丟出來的東西轉成錯誤物件：已經是就直接用，其他都算未預期的錯誤。
 * 程式堆疊放進細節：細節只進 log，畫面上不顯示。
 */
export function toPlatformError(
  reason: unknown,
  module: string,
  interfaceName: string,
): PlatformError {
  if (isPlatformError(reason)) return reason;
  if (!(reason instanceof Error)) {
    return createError(
      module,
      interfaceName,
      UnexpectedErrorCodes.PLATFORM_FRONTEND_UNEXPECTED_ERROR,
      `未預期的錯誤：${String(reason)}`,
    );
  }
  return createError(
    module,
    interfaceName,
    UnexpectedErrorCodes.PLATFORM_FRONTEND_UNEXPECTED_ERROR,
    `未預期的錯誤：${reason.message}`,
    { errorName: reason.name, stack: reason.stack },
  );
}

/** 判斷某個值是不是本專案格式的錯誤（含從 JSON 讀回來的一般物件）。 */
export function isPlatformError(value: unknown): value is PlatformError {
  if (value instanceof PlatformErrorObject) return true;
  if (typeof value !== 'object' || value === null) return false;
  const fields = value as Record<string, unknown>;
  return ['module', 'interfaceName', 'code', 'message'].every(
    (field) => typeof fields[field] === 'string',
  );
}

/** 只取出錯誤格式的欄位，丟掉程式堆疊等其他內容。 */
export function toPlainError(error: PlatformError): PlatformError {
  const plain: PlatformError = {
    module: error.module,
    interfaceName: error.interfaceName,
    code: error.code,
    message: error.message,
  };
  if (error.details !== undefined) plain.details = error.details;
  return plain;
}

// ===== 後端回傳的錯誤 =====

// 後端已經記錄過、回傳給前端的錯誤，前端不再寫 log（conventions.md 第 9 段）
const errorsFromBackend = new WeakSet<object>();

/** 標記這個錯誤是後端回傳的。 */
export function markAsFromBackend(error: PlatformErrorObject): void {
  errorsFromBackend.add(error);
}

/** 這個錯誤是不是後端回傳的（後端已經寫過 log）。 */
export function isFromBackend(error: unknown): boolean {
  return typeof error === 'object' && error !== null && errorsFromBackend.has(error);
}
