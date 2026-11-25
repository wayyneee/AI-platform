// PlatformInfrastructure 對外的資料型別：前端、後端與其他模組都依這裡的形狀交換資料。

// ===== 錯誤物件 =====

/** 本專案的錯誤格式（conventions.md 第 9 段）；HTTP 回應一律是 `{ error: PlatformError }`。 */
export interface PlatformError {
  /** 出錯的核心模組，例如 `PlatformInfrastructure` */
  module: string;
  /** 出錯的介面名稱，例如 `openDatabase` */
  interfaceName: string;
  /** 大寫加底線、前面加功能名稱，全平台不重複，例如 `MODEL_KEY_INVALID` */
  code: string;
  /** 寫給開發者看：在哪一步、為什麼失敗 */
  message: string;
  /** 供應商原始回應、HTTP 狀態等具體內容；不含程式堆疊、key、SQL 參數 */
  details?: unknown;
}

/** 錯誤回應的內容。 */
export interface ErrorResponse {
  error: PlatformError;
}

// ===== 系統 log =====

/** log 等級：正確、警告（使用者造成的失敗）、錯誤（系統或外部造成的失敗）。 */
export type LogLevel = 'success' | 'warning' | 'error';

/** 寫入 log 時提供的內容；時間與編號由 SystemLog 補上。 */
export interface LogInput {
  level: LogLevel;
  /** 發起這件事的核心模組 */
  module: string;
  /** 做了什麼，一句繁體中文，例如「測試模型：GPT-5」 */
  action: string;
  /** 結果的狀態文字，例如「已取消」 */
  status?: string;
  /** 耗時（毫秒） */
  durationMs?: number;
  /** 用量的文字說明，例如「輸入 120 token、輸出 30 token」 */
  usage?: string;
  /** 使用的 API key 名稱（只記名稱，不記 key） */
  keyName?: string;
  /** 失敗時的錯誤物件 */
  error?: PlatformError;
}

/** 一筆系統 log。 */
export interface LogEntry extends LogInput {
  id: string;
  /** ISO 8601（含時區） */
  time: string;
}
