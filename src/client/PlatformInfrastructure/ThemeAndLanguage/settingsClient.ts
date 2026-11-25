// 前端的平台設定：向後端查詢、儲存主題與語言，列出可以選的值。

import type {
  PlatformSettings,
  SettingOptions,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { requestBackend } from '../SystemLog/index.ts';

const MODULE_NAME = 'PlatformInfrastructure';

/** 查詢資料庫裡的主題、語言；失敗時丟出錯誤物件。 */
export async function getSettings(): Promise<PlatformSettings> {
  const result = await requestBackend<{ settings: PlatformSettings }>(MODULE_NAME, 'getSettings');
  return result.settings;
}

/** 儲存主題與語言，回傳儲存後的設定；重新整理頁面後才生效。失敗時丟出錯誤物件。 */
export async function updateSettings(settings: PlatformSettings): Promise<PlatformSettings> {
  const result = await requestBackend<{ settings: PlatformSettings }>(
    MODULE_NAME,
    'updateSettings',
    { body: settings },
  );
  return result.settings;
}

/** 列出可以選的主題與語言；失敗時丟出錯誤物件。 */
export async function listSettingOptions(): Promise<SettingOptions> {
  const result = await requestBackend<{ options: SettingOptions }>(
    MODULE_NAME,
    'listSettingOptions',
  );
  return result.options;
}
