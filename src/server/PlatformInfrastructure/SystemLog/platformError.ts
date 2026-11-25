// 錯誤物件：建立、判斷本專案格式的錯誤，並記住每個錯誤代碼的等級（警告或錯誤）。

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

/** 查詢錯誤代碼的等級；沒有登記過的代碼視為錯誤。 */
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
