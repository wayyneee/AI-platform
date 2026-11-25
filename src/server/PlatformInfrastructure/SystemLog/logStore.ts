// 系統 log 的存放：記憶體保留最近的 log 給畫面查詢、寫進紀錄檔（滿 10MB 換檔，只留 2 個檔），並即時通知訂閱者。

import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

import type { LogEntry, LogInput, LogLevel } from '../../../shared/PlatformInfrastructure/types.ts';
import { toPlainError } from './platformError.ts';

// spec：單檔上限 10MB，只保留最近 2 個檔；畫面最多保留最近 1000 筆
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ENTRIES_IN_MEMORY = 1000;
const CURRENT_LOG_FILE = 'system.log';
const PREVIOUS_LOG_FILE = 'system.1.log';
const LOG_LEVELS: readonly LogLevel[] = ['success', 'warning', 'error'];

export interface LogStoreOptions {
  maxFileBytes?: number;
  maxEntriesInMemory?: number;
}

export interface LogFilter {
  level?: LogLevel;
}

export type LogListener = (entry: LogEntry) => void;

// ===== 主要流程 =====

/** 一個 log 存放區；平台只用下方的一個，測試可以各自建立。 */
export class LogStore {
  private readonly maxFileBytes: number;
  private readonly maxEntries: number;
  private logDirectory: string | null = null;
  private entries: LogEntry[] = []; // 舊的在前
  private readonly listeners = new Set<LogListener>();
  // 記住已經寫過的錯誤物件：同一個錯誤只寫一筆（conventions.md 第 9 段）
  private readonly loggedErrors = new WeakSet<object>();

  constructor(options: LogStoreOptions = {}) {
    this.maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
    this.maxEntries = options.maxEntriesInMemory ?? MAX_ENTRIES_IN_MEMORY;
  }

  /** 開始把 log 寫進這個資料夾：先讀回之前的紀錄，再補寫開啟前就產生的 log。 */
  openFiles(directory: string): void {
    mkdirSync(directory, { recursive: true });
    const pendingEntries = this.entries;
    this.logDirectory = directory;
    this.entries = readEntriesFromFiles(directory).slice(-this.maxEntries);
    for (const entry of pendingEntries) {
      this.keepInMemory(entry);
      this.appendToFile(entry);
    }
  }

  /** 寫入一筆 log；這個錯誤物件已經寫過時略過，回傳 null。 */
  write(input: LogInput): LogEntry | null {
    if (input.error && this.loggedErrors.has(input.error)) return null;
    if (input.error) this.loggedErrors.add(input.error);

    const entry: LogEntry = {
      ...input,
      ...(input.error ? { error: toPlainError(input.error) } : {}),
      id: randomUUID(),
      time: new Date().toISOString(),
    };
    this.keepInMemory(entry);
    this.appendToFile(entry);
    this.notifyListeners(entry);
    return entry;
  }

  /** 查詢記憶體中的 log，新的在前。 */
  list(filter: LogFilter = {}): LogEntry[] {
    const newestFirst = [...this.entries].reverse();
    if (!filter.level) return newestFirst;
    return newestFirst.filter((entry) => entry.level === filter.level);
  }

  /** 訂閱新的 log，回傳取消訂閱的函式。 */
  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 這個錯誤物件是否已經寫進 log。 */
  wasErrorLogged(error: unknown): boolean {
    return typeof error === 'object' && error !== null && this.loggedErrors.has(error);
  }

  // ===== 記憶體與檔案 =====

  private keepInMemory(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries = this.entries.slice(-this.maxEntries);
  }

  /** 寫進紀錄檔；失敗時只在終端機顯示，不讓寫 log 的功能失敗（spec 規則）。 */
  private appendToFile(entry: LogEntry): void {
    if (!this.logDirectory) return;
    const line = `${JSON.stringify(entry)}
`;
    try {
      rotateIfFull(this.logDirectory, Buffer.byteLength(line), this.maxFileBytes);
      appendFileSync(path.join(this.logDirectory, CURRENT_LOG_FILE), line, 'utf8');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[SystemLog] 寫入紀錄檔失敗：${reason}
`);
    }
  }

  private notifyListeners(entry: LogEntry): void {
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // 某個訂閱者（例如已斷線的畫面）出錯，不影響其他訂閱者和寫 log 本身
      }
    }
  }
}

// ===== 輔助 =====

/** 讀回兩個紀錄檔裡的 log，舊的在前；損壞的行略過。 */
function readEntriesFromFiles(directory: string): LogEntry[] {
  return [PREVIOUS_LOG_FILE, CURRENT_LOG_FILE].flatMap((fileName) =>
    readEntriesFromFile(path.join(directory, fileName)),
  );
}

/** 目前的紀錄檔再寫就會超過上限時，把它改名成舊檔（原本的舊檔被取代），之後寫進新檔。 */
function rotateIfFull(directory: string, incomingBytes: number, maxFileBytes: number): void {
  const currentFile = path.join(directory, CURRENT_LOG_FILE);
  if (!existsSync(currentFile)) return;
  const currentBytes = statSync(currentFile).size;
  if (currentBytes === 0 || currentBytes + incomingBytes <= maxFileBytes) return;
  renameSync(currentFile, path.join(directory, PREVIOUS_LOG_FILE));
}

function readEntriesFromFile(filePath: string): LogEntry[] {
  if (!existsSync(filePath)) return [];
  const loaded: LogEntry[] = [];
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const entry = parseLogLine(line);
    if (entry) loaded.push(entry);
  }
  return loaded;
}

/** 把一行紀錄轉回 log；不是完整的 log（例如寫到一半斷電）時回傳 null。 */
function parseLogLine(line: string): LogEntry | null {
  if (!line.trim()) return null;
  try {
    const value: unknown = JSON.parse(line);
    return isLogEntry(value) ? value : null;
  } catch {
    return null;
  }
}

function isLogEntry(value: unknown): value is LogEntry {
  if (typeof value !== 'object' || value === null) return false;
  const fields = value as Record<string, unknown>;
  const hasTextFields = ['id', 'time', 'module', 'action'].every(
    (field) => typeof fields[field] === 'string',
  );
  return hasTextFields && LOG_LEVELS.includes(fields.level as LogLevel);
}

// ===== 平台使用的 log 存放區 =====

const platformLogStore = new LogStore();

/** 寫入一筆系統 log；同一個錯誤物件只會寫一次，之後再寫會被略過。寫檔失敗不會丟出錯誤。 */
export function writeLog(input: LogInput): void {
  platformLogStore.write(input);
}

/** 查詢最近的 log（最多 1000 筆），新的在前，可依等級篩選。 */
export function listLogs(filter: LogFilter = {}): LogEntry[] {
  return platformLogStore.list(filter);
}

/** 訂閱新寫入的 log，回傳取消訂閱的函式。 */
export function subscribeLogs(listener: LogListener): () => void {
  return platformLogStore.subscribe(listener);
}

/** 開始寫紀錄檔，由平台初始化時呼叫；之前的 log 會讀回來。 */
export function openLogFiles(directory: string): void {
  platformLogStore.openFiles(directory);
}

/** 這個錯誤物件是否已經寫進 log，用來避免同一個錯誤寫兩次。 */
export function wasErrorLogged(error: unknown): boolean {
  return platformLogStore.wasErrorLogged(error);
}
