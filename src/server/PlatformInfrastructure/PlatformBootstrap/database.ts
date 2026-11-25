// 共用的資料庫工具：開啟模組自己的 SQLite 檔、依版本自動升級結構，並提供讀寫方法。
// 共用的是「操作方法」不是資料：每個模組只開自己 data/<Module>/ 裡的檔案。

import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { createError, defineErrorCodes, writeLog } from '../SystemLog/index.ts';
import { ensureModuleDataDirectory } from './dataDirectory.ts';

const MODULE_NAME = 'PlatformInfrastructure';
const INTERFACE_NAME = 'openDatabase';
// 同一個資料庫檔可以由幾個小模組共用，各自的結構版本分開記在這張表
const VERSION_TABLE = 'schema_versions';

export const DatabaseErrorCodes = defineErrorCodes({
  DATABASE_OPEN_FAILED: 'error',
  DATABASE_UPGRADE_FAILED: 'error',
  DATABASE_VERSION_TOO_NEW: 'error',
  DATABASE_QUERY_FAILED: 'error',
});

/** 一版結構升級：SQL 文字，或需要搬資料時用函式。第 N 個元素就是第 N 版，已發布的版本不可修改。 */
export type Migration = string | ((database: ModuleDatabase) => void);

export type SqlParams = SQLInputValue[] | Record<string, SQLInputValue>;

export interface OpenDatabaseOptions {
  /** 核心模組名稱，資料庫放在 data/<module>/ */
  module: string;
  /** 資料庫檔名，例如 `platform-infrastructure.db` */
  fileName: string;
  /** 這組結構的名稱（通常是小模組名稱），共用同一個檔案時各自記錄版本 */
  schemaName: string;
  migrations: Migration[];
}

/** 模組拿到的讀寫方法；失敗時丟出 DATABASE_QUERY_FAILED，錯誤細節不含 SQL 參數。 */
export interface ModuleDatabase {
  /** 執行一句或多句不帶參數的 SQL，例如建立資料表。 */
  exec(sql: string): void;
  run(sql: string, params?: SqlParams): { changes: number; lastInsertRowid: number | bigint };
  get<Row>(sql: string, params?: SqlParams): Row | undefined;
  all<Row>(sql: string, params?: SqlParams): Row[];
  /** 在交易中執行；中途出錯時全部退回。已經在交易中時直接執行。 */
  transaction<Result>(work: () => Result): Result;
}

const openConnections = new Map<string, DatabaseSync>();

// ===== 主要流程 =====

/**
 * 開啟模組自己的資料庫檔（不存在時建立），並把這組結構升級到最新版。
 * 失敗時丟出錯誤：開不起來為 DATABASE_OPEN_FAILED、某一版升級失敗為 DATABASE_UPGRADE_FAILED（退回那一版）、
 * 資料庫比程式新為 DATABASE_VERSION_TOO_NEW（不修改任何資料）；升級成功和失敗都已寫進 log。
 */
export function openDatabase(options: OpenDatabaseOptions): ModuleDatabase {
  const connection = getConnection(options);
  const database = wrapConnection(connection);
  upgradeSchema(database, options);
  return database;
}

/** 關閉所有已開啟的資料庫；給測試在刪除暫存資料夾前使用。 */
export function closeAllDatabases(): void {
  for (const connection of openConnections.values()) connection.close();
  openConnections.clear();
}

// ===== 開啟 =====

/** 同一個檔案只開一個連線，之後重複使用。 */
function getConnection(options: OpenDatabaseOptions): DatabaseSync {
  const filePath = path.join(ensureModuleDataDirectory(options.module), options.fileName);
  const existing = openConnections.get(filePath);
  if (existing) return existing;

  try {
    const connection = new DatabaseSync(filePath);
    connection.exec('PRAGMA foreign_keys = ON');
    connection.exec(
      `CREATE TABLE IF NOT EXISTS ${VERSION_TABLE} (
        schema_name TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        upgraded_at TEXT NOT NULL
      )`,
    );
    openConnections.set(filePath, connection);
    return connection;
  } catch (cause) {
    throw failAndLog(
      DatabaseErrorCodes.DATABASE_OPEN_FAILED,
      `開啟資料庫失敗：${options.module}/${options.fileName}`,
      { module: options.module, fileName: options.fileName, reason: describeSqliteError(cause) },
    );
  }
}

// ===== 升級 =====

/** 只執行還沒執行過的版本；每一版在自己的交易中，失敗時退回那一版、停止升級。 */
function upgradeSchema(database: ModuleDatabase, options: OpenDatabaseOptions): void {
  const currentVersion = readSchemaVersion(database, options.schemaName);
  const latestVersion = options.migrations.length;
  const target = `${options.module}/${options.fileName}（${options.schemaName}）`;

  if (currentVersion > latestVersion) {
    throw failAndLog(
      DatabaseErrorCodes.DATABASE_VERSION_TOO_NEW,
      `資料庫 ${target} 是第 ${currentVersion} 版，比程式支援的第 ${latestVersion} 版新，請更新平台`,
      { schemaName: options.schemaName, currentVersion, latestVersion },
    );
  }

  for (let version = currentVersion + 1; version <= latestVersion; version++) {
    runMigration(database, options.migrations[version - 1], options.schemaName, version, target);
  }
}

function runMigration(
  database: ModuleDatabase,
  migration: Migration,
  schemaName: string,
  version: number,
  target: string,
): void {
  const startedAt = Date.now();
  try {
    database.transaction(() => {
      if (typeof migration === 'string') database.exec(migration);
      else migration(database);
      saveSchemaVersion(database, schemaName, version);
    });
  } catch (cause) {
    throw failAndLog(
      DatabaseErrorCodes.DATABASE_UPGRADE_FAILED,
      `資料庫 ${target} 升級到第 ${version} 版失敗，已退回第 ${version - 1} 版`,
      { schemaName, version, reason: describeSqliteError(cause) },
    );
  }
  writeLog({
    level: 'success',
    module: MODULE_NAME,
    action: `資料庫升級：${target} 第 ${version} 版`,
    durationMs: Date.now() - startedAt,
  });
}

function readSchemaVersion(database: ModuleDatabase, schemaName: string): number {
  const row = database.get<{ version: number }>(
    `SELECT version FROM ${VERSION_TABLE} WHERE schema_name = ?`,
    [schemaName],
  );
  return row?.version ?? 0;
}

function saveSchemaVersion(database: ModuleDatabase, schemaName: string, version: number): void {
  database.run(
    `INSERT INTO ${VERSION_TABLE} (schema_name, version, upgraded_at) VALUES (?, ?, ?)
     ON CONFLICT(schema_name) DO UPDATE SET version = excluded.version, upgraded_at = excluded.upgraded_at`,
    [schemaName, version, new Date().toISOString()],
  );
}

// ===== 讀寫方法 =====

function wrapConnection(connection: DatabaseSync): ModuleDatabase {
  const database: ModuleDatabase = {
    exec: (sql) => runStatement(sql, () => connection.exec(sql)),
    run: (sql, params) =>
      runStatement(sql, () => {
        const result = bindParams(connection.prepare(sql), params, 'run');
        return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
      }),
    get: (sql, params) =>
      runStatement(sql, () => bindParams(connection.prepare(sql), params, 'get')),
    all: (sql, params) =>
      runStatement(sql, () => bindParams(connection.prepare(sql), params, 'all')),
    transaction: (work) => runInTransaction(connection, work),
  };
  return database;
}

/** 依參數是陣列（? 位置）還是物件（:名稱）呼叫 SQLite。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- node:sqlite 三種方法的回傳型別不同，由呼叫的 ModuleDatabase 方法標明
function bindParams(statement: any, params: SqlParams | undefined, method: 'run' | 'get' | 'all') {
  if (params === undefined) return statement[method]();
  if (Array.isArray(params)) return statement[method](...params);
  return statement[method](params);
}

/** 執行 SQL；失敗時轉成錯誤物件。只放 SQL 文字，不放參數：參數可能有 key（spec 規則）。 */
function runStatement<Result>(sql: string, execute: () => Result): Result {
  try {
    return execute();
  } catch (cause) {
    throw createError(
      MODULE_NAME,
      INTERFACE_NAME,
      DatabaseErrorCodes.DATABASE_QUERY_FAILED,
      `執行 SQL 失敗：${describeSqliteError(cause)}`,
      { sql },
    );
  }
}

function runInTransaction<Result>(connection: DatabaseSync, work: () => Result): Result {
  if (connection.isTransaction) return work();
  connection.exec('BEGIN');
  try {
    const result = work();
    connection.exec('COMMIT');
    return result;
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}

// ===== 輔助 =====

/** 建立錯誤物件並寫一筆 log：開啟與升級是平台自己的事件，由這裡寫（conventions.md 第 9 段）。 */
function failAndLog(code: string, message: string, details: Record<string, unknown>): Error {
  const error = createError(MODULE_NAME, INTERFACE_NAME, code, message, details);
  writeLog({ level: 'error', module: MODULE_NAME, action: message, error });
  return error;
}

/** 取出 SQLite 的錯誤說明；node:sqlite 的錯誤訊息不含參數值。 */
function describeSqliteError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
