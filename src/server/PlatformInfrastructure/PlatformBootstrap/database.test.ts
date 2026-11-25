// 共用的資料庫工具：版本升級、升級失敗退回、資料庫比程式新、錯誤細節不含 SQL 參數。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isPlatformError } from '../SystemLog/index.ts';
import { closeAllDatabases, openDatabase, type Migration } from './database.ts';

const VERSION_1 = 'CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL)';
const VERSION_2 = 'ALTER TABLE notes ADD COLUMN created_at TEXT';
const VERSION_3 = 'CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL)';

let dataDirectory: string;

beforeEach(() => {
  dataDirectory = mkdtempSync(path.join(tmpdir(), 'platform-database-'));
  vi.stubEnv('PLATFORM_DATA_DIR', dataDirectory);
});

afterEach(() => {
  closeAllDatabases();
  vi.unstubAllEnvs();
  rmSync(dataDirectory, { recursive: true, force: true });
});

/** 開啟測試用的資料庫。 */
function openNotes(migrations: Migration[]) {
  return openDatabase({
    module: 'TestModule',
    fileName: 'test.db',
    schemaName: 'Notes',
    migrations,
  });
}

/** 執行並回傳丟出的錯誤；沒丟出錯誤時讓測試失敗。 */
function catchError(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  throw new Error('預期要丟出錯誤，但沒有');
}

/** 直接讀資料庫檔裡記錄的版本（不經過 openDatabase，避免觸發升級或版本檢查）。 */
function readVersion(): number | undefined {
  const connection = new DatabaseSync(path.join(dataDirectory, 'TestModule', 'test.db'));
  const row = connection
    .prepare("SELECT version FROM schema_versions WHERE schema_name = 'Notes'")
    .get() as { version: number } | undefined;
  connection.close();
  return row?.version;
}

describe('PlatformBootstrap 資料庫', () => {
  it('新資料庫從第 1 版升到最新版；舊資料庫只執行還沒執行過的版本', () => {
    const firstOpen = openNotes([VERSION_1, VERSION_2]);
    firstOpen.run('INSERT INTO notes (text, created_at) VALUES (?, ?)', ['第一筆', '2026-11-25']);

    // 第 1、2 版如果再執行一次會出錯（資料表、欄位已存在），能開啟代表只跑了第 3 版
    const version3 = vi.fn((database) => database.exec(VERSION_3));
    const secondOpen = openNotes([VERSION_1, VERSION_2, version3]);

    expect(version3).toHaveBeenCalledTimes(1);
    expect(secondOpen.all('SELECT text FROM notes')).toEqual([{ text: '第一筆' }]);
    expect(secondOpen.all('SELECT name FROM tags')).toEqual([]);
    closeAllDatabases();
    expect(readVersion()).toBe(3);
  });

  it('某一版升級失敗時退回那一版，之前的版本保留', () => {
    const brokenVersion2 = `${VERSION_2}; INSERT INTO table_that_does_not_exist VALUES (1)`;
    const error = catchError(() => openNotes([VERSION_1, brokenVersion2]));

    expect(error).toMatchObject({ code: 'DATABASE_UPGRADE_FAILED' });
    closeAllDatabases();
    expect(readVersion()).toBe(1);
    // 第 2 版的欄位也被退回
    const database = openNotes([VERSION_1]);
    const columns = database.all<{ name: string }>('PRAGMA table_info(notes)');
    expect(columns.map((column) => column.name)).toEqual(['id', 'text']);
  });

  it('資料庫版本比程式新時，資料不被修改並回報錯誤', () => {
    const newer = openNotes([VERSION_1, VERSION_2, VERSION_3]);
    newer.run('INSERT INTO notes (text) VALUES (?)', ['新版的資料']);
    closeAllDatabases();

    const error = catchError(() => openNotes([VERSION_1]));

    expect(isPlatformError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'DATABASE_VERSION_TOO_NEW' });
    closeAllDatabases();
    expect(readVersion()).toBe(3);
    const database = openNotes([VERSION_1, VERSION_2, VERSION_3]);
    expect(database.all('SELECT text FROM notes')).toEqual([{ text: '新版的資料' }]);
  });

  it('錯誤細節中不含 SQL 參數', () => {
    const database = openNotes([VERSION_1]);
    const secretKey = 'sk-test-secret-value-1234';

    const error = catchError(() =>
      database.run('INSERT INTO missing_table (key) VALUES (?)', [secretKey]),
    );

    expect(error).toMatchObject({ code: 'DATABASE_QUERY_FAILED' });
    expect(JSON.stringify(error)).not.toContain(secretKey);
    expect(String((error as Error).message)).not.toContain(secretKey);
  });
});
