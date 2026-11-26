// 前端的花費統計：向後端查詢統計、刪除已刪除 key 的用量紀錄。

import type { UsageStatsResult, UsageUnit } from '../../../shared/PlatformInfrastructure/types.ts';
import { requestBackend } from '../SystemLog/index.ts';

const MODULE_NAME = 'PlatformInfrastructure';

/** 查詢可以選的 key 和一組 key 的統計；沒給 keyId 時選第一組。失敗時丟出錯誤物件。 */
export async function getUsageStats(unit: UsageUnit, keyId?: string): Promise<UsageStatsResult> {
  return requestBackend<UsageStatsResult>(MODULE_NAME, 'getUsageStats', {
    query: { unit, keyId },
  });
}

/** 刪除一組已刪除 key 的所有用量紀錄；key 還在時丟出 USAGE_KEY_NOT_DELETED 等錯誤物件。 */
export async function deleteUsage(keyId: string): Promise<void> {
  await requestBackend<{ deletedCount: number }>(MODULE_NAME, 'deleteUsage', { body: { keyId } });
}
