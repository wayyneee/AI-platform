// 前端的 API key：向後端列出、新增、修改、刪除；前端只拿得到遮罩值。

import type {
  ApiKeyChanges,
  ApiKeySummary,
  NewApiKey,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { requestBackend } from '../SystemLog/index.ts';

const MODULE_NAME = 'PlatformInfrastructure';

/** 列出所有 API key（依新增的先後）；失敗時丟出錯誤物件。 */
export async function listApiKeys(): Promise<ApiKeySummary[]> {
  const result = await requestBackend<{ keys: ApiKeySummary[] }>(MODULE_NAME, 'listApiKeys');
  return result.keys;
}

/** 新增一組 API key，回傳遮罩後的內容；同供應商同名時丟出 API_KEY_NAME_TAKEN 等錯誤物件。 */
export async function addApiKey(input: NewApiKey): Promise<ApiKeySummary> {
  const result = await requestBackend<{ key: ApiKeySummary }>(MODULE_NAME, 'addApiKey', {
    body: input,
  });
  return result.key;
}

/** 修改名稱和 key（keyValue 留空代表不變），回傳遮罩後的內容；失敗時丟出錯誤物件。 */
export async function updateApiKey(changes: ApiKeyChanges): Promise<ApiKeySummary> {
  const result = await requestBackend<{ key: ApiKeySummary }>(MODULE_NAME, 'updateApiKey', {
    body: changes,
  });
  return result.key;
}

/** 刪除一組 API key；找不到時丟出 API_KEY_NOT_FOUND 等錯誤物件。 */
export async function deleteApiKey(id: string): Promise<void> {
  await requestBackend<{ key: ApiKeySummary }>(MODULE_NAME, 'deleteApiKey', { body: { id } });
}
