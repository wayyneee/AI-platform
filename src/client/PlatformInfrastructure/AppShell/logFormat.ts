// log 列的資料整理：合併新舊 log（新的在前、最多 1000 筆）、時間與耗時的顯示格式。

import type { LogEntry, LogLevel } from '../../../shared/PlatformInfrastructure/types.ts';
import type { BadgeTone } from '../SharedComponents/index.ts';

// spec：畫面最多保留最近 1000 筆
export const MAX_LOG_ENTRIES = 1000;
const MILLISECONDS_PER_SECOND = 1000;

export const LOG_LEVEL_TONES: Record<LogLevel, BadgeTone> = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
};

// ===== 合併 =====

/** 把新收到的 log 併進目前的列表：同一筆不重複，新的在前，只留最近的 1000 筆。 */
export function mergeLogEntries(current: LogEntry[], incoming: LogEntry[]): LogEntry[] {
  const byId = new Map<string, LogEntry>();
  for (const entry of [...current, ...incoming]) byId.set(entry.id, entry);
  return [...byId.values()]
    .sort((first, second) => Date.parse(second.time) - Date.parse(first.time))
    .slice(0, MAX_LOG_ENTRIES);
}

// ===== 顯示格式 =====

/** log 的時間：電腦當地時間的 `MM-DD HH:mm:ss`。 */
export function formatLogTime(isoTime: string): string {
  const time = new Date(isoTime);
  const date = `${pad(time.getMonth() + 1)}-${pad(time.getDate())}`;
  const clock = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
  return `${date} ${clock}`;
}

/** 耗時：不到 1 秒顯示毫秒（`12ms`），1 秒以上顯示到小數一位（`1.2s`）。 */
export function formatDuration(durationMs: number): string {
  if (durationMs < MILLISECONDS_PER_SECOND) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / MILLISECONDS_PER_SECOND).toFixed(1)}s`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
