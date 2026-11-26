// 用量紀錄的資料：每次呼叫記一筆（記在 key 底下，key 刪除後保留）、列出有紀錄的 key、刪除已刪除 key 的紀錄。

import { randomUUID } from 'node:crypto';

import type {
  ApiKeySummary,
  LlmUsage,
  MediaUsage,
  ProviderId,
  SavedModel,
  UsageAmounts,
  UsageCost,
  UsageKey,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { listApiKeys } from '../ModelRegistry/index.ts';
import { openDatabase, type ModuleDatabase } from '../PlatformBootstrap/index.ts';
import { createError, defineErrorCodes } from '../SystemLog/index.ts';
import { calculateUsage } from './usageCost.ts';

const MODULE_NAME = 'PlatformInfrastructure';
// 和 ThemeAndLanguage、ModelRegistry 共用同一個檔案，結構版本各自記錄（spec 第 8 段）
const DATABASE_FILE = 'platform-infrastructure.db';
const SCHEMA_NAME = 'UsageAndCost';
const FORGE_PROVIDER: ProviderId = 'forge';

// 已發布的版本不可修改，只能往後新增（conventions.md 第 9 段）
const MIGRATIONS = [
  // 第 1 版：用量紀錄。key_id 不用外鍵：key 刪除後紀錄要保留（spec 規則），所以另外存當時的 key 名稱；
  // 花費在記錄當下算好存起來，之後改模型價格不影響舊紀錄
  `CREATE TABLE usage_records (
    id TEXT PRIMARY KEY,
    key_id TEXT NOT NULL,
    key_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    model_type TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    search_count INTEGER NOT NULL,
    image_count INTEGER NOT NULL,
    video_seconds REAL NOT NULL,
    character_count INTEGER NOT NULL,
    cost_usd REAL NOT NULL,
    has_priced_usage INTEGER NOT NULL,
    has_unpriced_usage INTEGER NOT NULL,
    recorded_at TEXT NOT NULL
  );
  CREATE INDEX usage_records_by_key_time ON usage_records (key_id, recorded_at);`,
];

export const UsageRecordErrorCodes = defineErrorCodes({
  USAGE_KEY_REQUIRED: 'error',
  USAGE_KEY_NOT_FOUND: 'warning',
  USAGE_KEY_NOT_DELETED: 'warning',
});

/** 記錄一次呼叫的用量：用了哪個模型、哪組 key（雲端供應商才有）、用量。 */
export interface UsageToRecord {
  model: SavedModel;
  /** 這次呼叫使用的 key；Forge 為 null */
  keyId: string | null;
  /** 當時的 key 名稱；key 刪除後統計畫面靠它顯示 */
  keyName?: string;
  usage: LlmUsage | MediaUsage;
}

/** 從資料庫讀出的一筆用量（只有統計要用的欄位）。 */
export interface UsageRow {
  input_tokens: number;
  output_tokens: number;
  search_count: number;
  image_count: number;
  video_seconds: number;
  character_count: number;
  cost_usd: number;
  has_priced_usage: number;
  has_unpriced_usage: number;
  recorded_at: string;
}

// ===== 記錄 =====

/**
 * 記錄一次呼叫的用量，回傳算好的花費（依當下的模型價格）。本地 Forge 不花錢，不記錄，回傳 null。
 * 雲端供應商沒有 key 時丟出 USAGE_KEY_REQUIRED；資料庫出錯時丟出 DATABASE_ 開頭的錯誤。
 */
export function recordUsage(input: UsageToRecord): UsageCost | null {
  if (input.model.provider === FORGE_PROVIDER) return null;
  if (!input.keyId) {
    throw createError(
      MODULE_NAME,
      'recordUsage',
      UsageRecordErrorCodes.USAGE_KEY_REQUIRED,
      `記錄「${input.model.displayName}」的用量時沒有 key，用量要記在 key 底下`,
      { modelId: input.model.id },
    );
  }
  const amounts = calculateUsage(input.model, input.usage);
  insertRecord(input, input.keyId, amounts);
  return {
    costUsd: amounts.costUsd,
    hasPricedUsage: amounts.hasPricedUsage,
    hasUnpricedUsage: amounts.hasUnpricedUsage,
  };
}

// ===== 查詢 =====

/**
 * 花費統計可以選的 key：現有的 key（依新增的先後），接著是已刪除但還有紀錄的 key（最近用過的在前）。
 * 資料庫出錯時丟出 DATABASE_ 開頭的錯誤。
 */
export function listUsageKeys(): UsageKey[] {
  const existingKeys = listApiKeys();
  const existingIds = new Set(existingKeys.map((key) => key.id));
  const deletedKeys = listRecordedKeys().filter((key) => !existingIds.has(key.id));
  return [...existingKeys.map(toExistingUsageKey), ...deletedKeys];
}

/** 一組 key 在一段期間（含開始、不含結束）的用量紀錄。 */
export function listUsageRows(keyId: string, from: Date, until: Date): UsageRow[] {
  return openUsageDatabase().all<UsageRow>(
    `SELECT input_tokens, output_tokens, search_count, image_count, video_seconds, character_count,
            cost_usd, has_priced_usage, has_unpriced_usage, recorded_at
     FROM usage_records WHERE key_id = ? AND recorded_at >= ? AND recorded_at < ?`,
    [keyId, from.toISOString(), until.toISOString()],
  );
}

/** 找一組可以選的 key；找不到時丟出 USAGE_KEY_NOT_FOUND（key 已刪除、紀錄也刪了）。 */
export function requireUsageKey(keys: UsageKey[], keyId: string, interfaceName: string): UsageKey {
  const key = keys.find((candidate) => candidate.id === keyId);
  if (key) return key;
  throw createError(
    MODULE_NAME,
    interfaceName,
    UsageRecordErrorCodes.USAGE_KEY_NOT_FOUND,
    `找不到編號為 ${keyId} 的 key，也沒有它的用量紀錄`,
    { keyId },
  );
}

// ===== 刪除 =====

/**
 * 刪除一組已刪除 key 的所有用量紀錄，回傳刪除的筆數。只有已刪除的 key 可以刪（spec 規則）。
 * key 還在時丟出 USAGE_KEY_NOT_DELETED；找不到這組 key 的紀錄時丟出 USAGE_KEY_NOT_FOUND。
 */
export function deleteUsage(keyId: string): number {
  const interfaceName = 'deleteUsage';
  const key = requireUsageKey(listUsageKeys(), keyId, interfaceName);
  if (!key.isDeleted) {
    throw createError(
      MODULE_NAME,
      interfaceName,
      UsageRecordErrorCodes.USAGE_KEY_NOT_DELETED,
      `key「${key.name}」還沒有刪除，只能刪除已刪除 key 的用量紀錄`,
      { keyId },
    );
  }
  return openUsageDatabase().run('DELETE FROM usage_records WHERE key_id = ?', [keyId]).changes;
}

// ===== 輔助 =====

/** 第一次使用時才開啟並升級資料庫（spec 重要決定）；之後重複使用同一個連線。 */
function openUsageDatabase(): ModuleDatabase {
  return openDatabase({
    module: MODULE_NAME,
    fileName: DATABASE_FILE,
    schemaName: SCHEMA_NAME,
    migrations: MIGRATIONS,
  });
}

function insertRecord(input: UsageToRecord, keyId: string, amounts: UsageAmounts): void {
  openUsageDatabase().run(
    `INSERT INTO usage_records (
       id, key_id, key_name, provider, model_id, model_name, model_type,
       input_tokens, output_tokens, search_count, image_count, video_seconds, character_count,
       cost_usd, has_priced_usage, has_unpriced_usage, recorded_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      keyId,
      input.keyName ?? '',
      input.model.provider,
      input.model.id,
      input.model.displayName,
      input.model.type,
      amounts.inputTokens,
      amounts.outputTokens,
      amounts.searchCount,
      amounts.imageCount,
      amounts.videoSeconds,
      amounts.characterCount,
      amounts.costUsd,
      amounts.hasPricedUsage ? 1 : 0,
      amounts.hasUnpricedUsage ? 1 : 0,
      new Date().toISOString(),
    ],
  );
}

/** 有紀錄的每組 key，名稱取最後一筆紀錄當時的名稱（SQLite 搭配 MAX 時，其他欄位取自那一筆）。 */
function listRecordedKeys(): UsageKey[] {
  const rows = openUsageDatabase().all<{ key_id: string; provider: ProviderId; key_name: string }>(
    `SELECT key_id, provider, key_name, MAX(recorded_at) AS last_recorded_at
     FROM usage_records GROUP BY key_id ORDER BY last_recorded_at DESC`,
  );
  return rows.map((row) => ({
    id: row.key_id,
    provider: row.provider,
    name: row.key_name,
    isDeleted: true,
  }));
}

function toExistingUsageKey(key: ApiKeySummary): UsageKey {
  return { id: key.id, provider: key.provider, name: key.name, isDeleted: false };
}
