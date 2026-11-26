// ModelRegistry 的資料庫：API key 和模型存在本模組共用的資料庫檔，結構版本以 ModelRegistry 記錄。

import { openDatabase, type ModuleDatabase } from '../PlatformBootstrap/index.ts';

const MODULE_NAME = 'PlatformInfrastructure';
// 和 ThemeAndLanguage、UsageAndCost 共用同一個檔案，結構版本各自記錄（spec 第 8 段）
const DATABASE_FILE = 'platform-infrastructure.db';
const SCHEMA_NAME = 'ModelRegistry';

// 已發布的版本不可修改，只能往後新增（conventions.md 第 9 段）
const MIGRATIONS = [
  // 第 1 版：API key。key 值不加密（conventions.md 第 9 段：機密資訊）；同供應商不能同名
  `CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    key_value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (provider, name)
  )`,
  // 第 2 版：模型。刪除 key 時不刪模型，由外鍵把 key_id 清成 NULL（spec 規則）；
  // 價格、能力、參數定義依類型形狀不同，存 JSON 文字
  `CREATE TABLE models (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    key_id TEXT REFERENCES api_keys (id) ON DELETE SET NULL,
    address TEXT,
    price TEXT NOT NULL,
    capabilities TEXT,
    params TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

/** 第一次使用時才開啟並升級資料庫（spec 重要決定）；之後重複使用同一個連線。失敗時丟出 DATABASE_ 開頭的錯誤。 */
export function openRegistryDatabase(): ModuleDatabase {
  return openDatabase({
    module: MODULE_NAME,
    fileName: DATABASE_FILE,
    schemaName: SCHEMA_NAME,
    migrations: MIGRATIONS,
  });
}
