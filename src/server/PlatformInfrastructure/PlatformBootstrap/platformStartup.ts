// 平台啟動初始化：建立 data/、開始寫系統紀錄檔，完成時寫一筆 log。
// 各模組的資料庫不在這裡開啟，第一次使用時才開（spec 重要決定）。

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { openLogFiles, writeLog } from '../SystemLog/index.ts';
import { resolveDataDirectory } from './dataDirectory.ts';

const MODULE_NAME = 'PlatformInfrastructure';

/** 後端啟動時初始化平台；重複呼叫不會出錯。 */
export function initializePlatform(): void {
  const startedAt = Date.now();
  const dataDirectory = resolveDataDirectory();
  mkdirSync(dataDirectory, { recursive: true });
  // 系統紀錄檔放在本模組自己的資料夾 data/PlatformInfrastructure/
  openLogFiles(path.join(dataDirectory, MODULE_NAME));
  writeLog({
    level: 'success',
    module: MODULE_NAME,
    action: '平台初始化完成',
    durationMs: Date.now() - startedAt,
  });
}
