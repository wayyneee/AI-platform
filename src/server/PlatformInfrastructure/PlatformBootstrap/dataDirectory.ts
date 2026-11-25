// 資料路徑：決定 data/ 在哪裡，並在自動測試時確保不會碰到正式的 data/。

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { createError, defineErrorCodes } from '../SystemLog/index.ts';

const MODULE_NAME = 'PlatformInfrastructure';
// 自動測試用這個環境變數指向暫存資料夾（conventions.md 第 9 段）
const DATA_DIRECTORY_ENV = 'PLATFORM_DATA_DIR';
// 這個檔案在 src/server/PlatformInfrastructure/PlatformBootstrap/，往上四層是專案根目錄
const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../../..');
const DEFAULT_DATA_DIRECTORY = path.join(PROJECT_ROOT, 'data');

export const DataDirectoryErrorCodes = defineErrorCodes({
  PLATFORM_TEST_DATA_DIRECTORY_MISSING: 'error',
});

/** 取得 data/ 的位置；有設定 PLATFORM_DATA_DIR 時用它。測試中沒設定時丟出錯誤，避免寫到正式資料。 */
export function resolveDataDirectory(): string {
  const configured = process.env[DATA_DIRECTORY_ENV];
  if (configured) return path.resolve(configured);
  if (process.env.VITEST) {
    throw createError(
      MODULE_NAME,
      'resolveDataDirectory',
      DataDirectoryErrorCodes.PLATFORM_TEST_DATA_DIRECTORY_MISSING,
      `自動測試沒有設定 ${DATA_DIRECTORY_ENV}，為了不碰正式的 data/ 而停止`,
    );
  }
  return DEFAULT_DATA_DIRECTORY;
}

/** 取得某個模組的資料夾 data/<Module>/，不存在時建立。 */
export function ensureModuleDataDirectory(module: string): string {
  const directory = path.join(resolveDataDirectory(), module);
  mkdirSync(directory, { recursive: true });
  return directory;
}
