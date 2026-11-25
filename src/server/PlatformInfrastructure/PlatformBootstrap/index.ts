// PlatformBootstrap 的唯一入口：平台啟動初始化、共用的資料庫工具。

export { initializePlatform } from './platformStartup.ts';
export { openDatabase } from './database.ts';
export type { Migration, ModuleDatabase, OpenDatabaseOptions, SqlParams } from './database.ts';
