// 前端的系統 log：寫入一筆 log、查詢最近的 log、即時接收新的 log（SSE）。log 都存在後端。

import type { LogEntry, LogInput, LogLevel } from '../../../shared/PlatformInfrastructure/types.ts';
import { requestBackend } from './backendRequest.ts';

const MODULE_NAME = 'PlatformInfrastructure';
const SUBSCRIBE_URL = '/api/PlatformInfrastructure/subscribeLogs';

// ===== 寫入 =====

/** 寫入一筆系統 log。不會失敗：寫 log 不能讓呼叫它的功能壞掉（spec 規則）。 */
export function writeLog(input: LogInput): void {
  requestBackend(MODULE_NAME, 'writeLog', { body: input }).catch(() => {
    // 後端連不上時 log 也送不出去；畫面上的錯誤由呼叫的功能自己顯示，這裡不再處理
  });
}

// ===== 查詢與訂閱 =====

/** 查詢後端記憶體中的 log，新的在前；可以只查某個等級。 */
export async function listLogs(level?: LogLevel): Promise<LogEntry[]> {
  const result = await requestBackend<{ logs: LogEntry[] }>(MODULE_NAME, 'listLogs', {
    query: { level },
  });
  return result.logs;
}

export interface LogSubscriber {
  /** 收到一筆新的 log */
  onEntry: (entry: LogEntry) => void;
  /** 連線建立（含斷線後自動重連）時；斷線期間可能漏掉 log，可以在這時重新查詢 */
  onConnected?: () => void;
}

/** 即時接收新的 log，回傳取消訂閱的函式。斷線時瀏覽器會自動重連。 */
export function subscribeLogs(subscriber: LogSubscriber): () => void {
  const source = new EventSource(SUBSCRIBE_URL);
  source.onopen = () => subscriber.onConnected?.();
  source.onmessage = (event: MessageEvent<string>) => {
    subscriber.onEntry(JSON.parse(event.data) as LogEntry);
  };
  return () => source.close();
}
