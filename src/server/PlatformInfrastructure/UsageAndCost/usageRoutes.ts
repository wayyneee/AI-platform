// 花費統計的 HTTP 路由：查詢統計（只讀，失敗才寫 log）、刪除已刪除 key 的紀錄（成功失敗都寫）。

import type { FastifyInstance } from 'fastify';

import type { UsageStatsResult, UsageUnit } from '../../../shared/PlatformInfrastructure/types.ts';
import { describeKey } from '../ModelRegistry/index.ts';
import { logFailure, logOutcome } from '../SystemLog/index.ts';
import { deleteUsage, listUsageKeys } from './usageRecords.ts';
import { getUsageStats } from './usageStats.ts';

const MODULE_NAME = 'PlatformInfrastructure';

const getUsageStatsQuerySchema = {
  type: 'object',
  required: ['unit'],
  additionalProperties: false,
  properties: {
    keyId: { type: 'string' },
    unit: { type: 'string', enum: ['hour', 'day', 'week', 'month'] },
  },
};

const deleteUsageBodySchema = {
  type: 'object',
  required: ['keyId'],
  additionalProperties: false,
  properties: { keyId: { type: 'string' } },
};

/** 登記花費統計的路由：`getUsageStats`、`deleteUsage`。 */
export async function registerUsageRoutes(server: FastifyInstance): Promise<void> {
  // 單純讀取本機資料：只在失敗時寫 log
  server.get<{ Querystring: { keyId?: string; unit: UsageUnit } }>(
    '/getUsageStats',
    { schema: { querystring: getUsageStatsQuerySchema } },
    async (request): Promise<UsageStatsResult> => {
      const { keyId, unit } = request.query;
      return logFailure(MODULE_NAME, '查詢花費統計', () => getUsageStats({ keyId, unit }));
    },
  );

  // 會改變資料：成功和失敗都寫
  server.post<{ Body: { keyId: string } }>(
    '/deleteUsage',
    { schema: { body: deleteUsageBodySchema } },
    async (request): Promise<{ deletedCount: number }> => {
      const { keyId } = request.body;
      const key = findUsageKeyForLog(keyId);
      const action = `刪除用量紀錄：${key ? describeKey(key.provider, key.name) : keyId}`;
      const deletedCount = logOutcome(MODULE_NAME, action, () => deleteUsage(keyId), {
        keyName: key?.name,
      });
      return { deletedCount };
    },
  );
}

/** 寫 log 前先取得 key 的名稱；讀不到時 log 改寫編號，刪除本身的錯誤由 deleteUsage 回報。 */
function findUsageKeyForLog(keyId: string) {
  try {
    return listUsageKeys().find((key) => key.id === keyId);
  } catch {
    return undefined;
  }
}
