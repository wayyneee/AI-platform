// API key 的新增、列出、修改、刪除：完整的 key 只留在後端，對外一律回傳遮罩值。

import { randomUUID } from 'node:crypto';

import {
  PROVIDERS_REQUIRING_KEY,
  type ApiKeyChanges,
  type ApiKeySummary,
  type NewApiKey,
  type ProviderId,
} from '../../../shared/PlatformInfrastructure/types.ts';
import type { ModuleDatabase } from '../PlatformBootstrap/index.ts';
import { createError, defineErrorCodes } from '../SystemLog/index.ts';
import { openRegistryDatabase } from './registryDatabase.ts';

const MODULE_NAME = 'PlatformInfrastructure';
// spec 規則：長度 12 以上顯示前 3 碼 + **** + 後 4 碼，未滿 12 只顯示 ****
const MASK_MIN_LENGTH = 12;
const MASK_HEAD_LENGTH = 3;
const MASK_TAIL_LENGTH = 4;
const MASK_TEXT = '****';

export const ApiKeyErrorCodes = defineErrorCodes({
  API_KEY_PROVIDER_INVALID: 'warning',
  API_KEY_NAME_REQUIRED: 'warning',
  API_KEY_VALUE_REQUIRED: 'warning',
  API_KEY_NAME_TAKEN: 'warning',
  API_KEY_NOT_FOUND: 'warning',
});

interface ApiKeyRow {
  id: string;
  provider: ProviderId;
  name: string;
  key_value: string;
}

// ===== 查詢 =====

/** 列出所有 API key（依新增的先後），只有遮罩值。資料庫出錯時丟出 DATABASE_ 開頭的錯誤。 */
export function listApiKeys(): ApiKeySummary[] {
  const rows = openRegistryDatabase().all<ApiKeyRow>(
    'SELECT id, provider, name, key_value FROM api_keys ORDER BY created_at, rowid',
  );
  return rows.map(toSummary);
}

/** 找一組 API key；找不到時回傳 undefined（給路由在寫 log 前取得名稱用）。 */
export function findApiKey(id: string): ApiKeySummary | undefined {
  const row = findRow(openRegistryDatabase(), id);
  return row ? toSummary(row) : undefined;
}

/** 取得完整的 key 值，只給後端呼叫供應商時使用，不可放進回應或 log。找不到時丟出 API_KEY_NOT_FOUND。 */
export function getApiKeyValue(id: string): string {
  return requireRow(openRegistryDatabase(), id, 'getApiKeyValue').key_value;
}

// ===== 新增 =====

/**
 * 新增一組 API key，回傳遮罩後的內容。
 * 供應商不需要 key 時丟出 API_KEY_PROVIDER_INVALID；名稱或 key 空白時丟出 API_KEY_NAME_REQUIRED／API_KEY_VALUE_REQUIRED；
 * 同供應商已有同名的 key 時丟出 API_KEY_NAME_TAKEN。
 */
export function addApiKey(input: NewApiKey): ApiKeySummary {
  const interfaceName = 'addApiKey';
  checkProviderNeedsKey(input.provider, interfaceName);
  const name = requireName(input.name, interfaceName);
  const keyValue = requireKeyValue(input.keyValue, interfaceName);

  const database = openRegistryDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();
  database.transaction(() => {
    checkNameAvailable(database, input.provider, name, null, interfaceName);
    database.run(
      `INSERT INTO api_keys (id, provider, name, key_value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.provider, name, keyValue, now, now],
    );
  });
  return toSummary({ id, provider: input.provider, name, key_value: keyValue });
}

// ===== 修改 =====

/**
 * 修改 API key 的名稱和 key 值（keyValue 留空代表不變），回傳遮罩後的內容；供應商不能改。
 * 找不到時丟出 API_KEY_NOT_FOUND；名稱空白時丟出 API_KEY_NAME_REQUIRED；和同供應商的其他 key 同名時丟出 API_KEY_NAME_TAKEN。
 */
export function updateApiKey(changes: ApiKeyChanges): ApiKeySummary {
  const interfaceName = 'updateApiKey';
  const name = requireName(changes.name, interfaceName);
  const newKeyValue = changes.keyValue?.trim() ?? '';

  const database = openRegistryDatabase();
  return database.transaction(() => {
    const row = requireRow(database, changes.id, interfaceName);
    checkNameAvailable(database, row.provider, name, row.id, interfaceName);
    // 留空代表不變（spec 規則）
    const keyValue = newKeyValue || row.key_value;
    database.run('UPDATE api_keys SET name = ?, key_value = ?, updated_at = ? WHERE id = ?', [
      name,
      keyValue,
      new Date().toISOString(),
      row.id,
    ]);
    return toSummary({ ...row, name, key_value: keyValue });
  });
}

// ===== 刪除 =====

/** 刪除一組 API key，回傳刪除前的內容（遮罩後）。找不到時丟出 API_KEY_NOT_FOUND。 */
export function deleteApiKey(id: string): ApiKeySummary {
  const interfaceName = 'deleteApiKey';
  const database = openRegistryDatabase();
  return database.transaction(() => {
    const row = requireRow(database, id, interfaceName);
    database.run('DELETE FROM api_keys WHERE id = ?', [id]);
    return toSummary(row);
  });
}

// ===== 遮罩 =====

/** key 的遮罩值：長度 12 以上為前 3 碼 + `****` + 後 4 碼，未滿 12 只有 `****`（spec 規則）。 */
export function maskApiKey(keyValue: string): string {
  if (keyValue.length < MASK_MIN_LENGTH) return MASK_TEXT;
  return keyValue.slice(0, MASK_HEAD_LENGTH) + MASK_TEXT + keyValue.slice(-MASK_TAIL_LENGTH);
}

// ===== 檢查 =====
// 錯誤細節只放供應商、名稱、編號，一律不放 key 值（spec 驗收條件）

function checkProviderNeedsKey(provider: ProviderId, interfaceName: string): void {
  if (PROVIDERS_REQUIRING_KEY.includes(provider)) return;
  throw createError(
    MODULE_NAME,
    interfaceName,
    ApiKeyErrorCodes.API_KEY_PROVIDER_INVALID,
    `供應商「${provider}」不需要 API key，或平台不支援這個供應商`,
    { provider, providersRequiringKey: PROVIDERS_REQUIRING_KEY },
  );
}

/** 名稱去掉前後空白後不能是空的；回傳去掉空白後的名稱。 */
function requireName(name: string, interfaceName: string): string {
  const trimmed = name.trim();
  if (trimmed) return trimmed;
  throw createError(
    MODULE_NAME,
    interfaceName,
    ApiKeyErrorCodes.API_KEY_NAME_REQUIRED,
    'API key 的名稱是空的',
  );
}

/** key 值去掉前後空白後不能是空的：從網頁複製時常會多帶空白或換行。 */
function requireKeyValue(keyValue: string, interfaceName: string): string {
  const trimmed = keyValue.trim();
  if (trimmed) return trimmed;
  throw createError(
    MODULE_NAME,
    interfaceName,
    ApiKeyErrorCodes.API_KEY_VALUE_REQUIRED,
    '新增 API key 時沒有填 key',
  );
}

/** 同一家供應商不能有同名的 key；修改時排除自己。 */
function checkNameAvailable(
  database: ModuleDatabase,
  provider: ProviderId,
  name: string,
  ownId: string | null,
  interfaceName: string,
): void {
  const taken = database.get<{ id: string }>(
    'SELECT id FROM api_keys WHERE provider = ? AND name = ? AND id IS NOT ?',
    [provider, name, ownId],
  );
  if (!taken) return;
  throw createError(
    MODULE_NAME,
    interfaceName,
    ApiKeyErrorCodes.API_KEY_NAME_TAKEN,
    `供應商「${provider}」已經有名稱為「${name}」的 API key`,
    { provider, name },
  );
}

function requireRow(database: ModuleDatabase, id: string, interfaceName: string): ApiKeyRow {
  const row = findRow(database, id);
  if (row) return row;
  throw createError(
    MODULE_NAME,
    interfaceName,
    ApiKeyErrorCodes.API_KEY_NOT_FOUND,
    `找不到編號為 ${id} 的 API key，可能已經被刪除`,
    { id },
  );
}

// ===== 輔助 =====

function findRow(database: ModuleDatabase, id: string): ApiKeyRow | undefined {
  return database.get<ApiKeyRow>(
    'SELECT id, provider, name, key_value FROM api_keys WHERE id = ?',
    [id],
  );
}

function toSummary(row: ApiKeyRow): ApiKeySummary {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    maskedKey: maskApiKey(row.key_value),
  };
}
