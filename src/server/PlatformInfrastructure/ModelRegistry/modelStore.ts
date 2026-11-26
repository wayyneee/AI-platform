// 已儲存模型的資料：新增、列出、查詢、換 key、刪除；價格的檢查與整理。
// 偵測與測試由 modelDetection 負責，這裡只讀寫資料庫。

import { randomUUID } from 'node:crypto';

import type {
  DetectedModel,
  LlmCapabilities,
  ModelPrice,
  ModelType,
  ParamDefinition,
  ProviderId,
  SavedModel,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { createError, defineErrorCodes } from '../SystemLog/index.ts';
import { checkKeyForProvider, type ResolvedConnection } from './modelConnection.ts';
import { openRegistryDatabase } from './registryDatabase.ts';

const MODULE_NAME = 'PlatformInfrastructure';
const FORGE_PROVIDER: ProviderId = 'forge';
// OpenRouter 直接回報搜尋金額，不用填每次搜尋價格（spec 規則）
const PROVIDER_REPORTING_SEARCH_COST: ProviderId = 'openrouter';
const LLM_TOKEN_PRICE_FIELDS = ['inputPerMillionTokens', 'outputPerMillionTokens'] as const;

export const ModelStoreErrorCodes = defineErrorCodes({
  MODEL_NAME_REQUIRED: 'warning',
  MODEL_PRICE_INVALID: 'warning',
  MODEL_NOT_FOUND: 'warning',
});

/** 新增一個模型時寫進資料庫的內容：偵測到的模型、連線、顯示名稱、價格。 */
export interface ModelToInsert {
  detected: DetectedModel;
  connection: ResolvedConnection;
  displayName: string;
  price: ModelPrice;
}

interface ModelRow {
  id: string;
  type: ModelType;
  provider: ProviderId;
  model_id: string;
  display_name: string;
  key_id: string | null;
  address: string | null;
  price: string;
  capabilities: string | null;
  params: string;
}

const SELECT_COLUMNS =
  'id, type, provider, model_id, display_name, key_id, address, price, capabilities, params';

// ===== 查詢 =====

/** 列出已儲存的模型（依新增的先後），可依類型篩選。資料庫出錯時丟出 DATABASE_ 開頭的錯誤。 */
export function listModels(type?: ModelType): SavedModel[] {
  const database = openRegistryDatabase();
  const order = 'ORDER BY created_at, rowid';
  const rows = type
    ? database.all<ModelRow>(`SELECT ${SELECT_COLUMNS} FROM models WHERE type = ? ${order}`, [type])
    : database.all<ModelRow>(`SELECT ${SELECT_COLUMNS} FROM models ${order}`);
  return rows.map(toSavedModel);
}

/** 找一個模型；找不到時回傳 undefined（給路由在寫 log 前取得名稱用）。 */
export function findModel(id: string): SavedModel | undefined {
  const row = openRegistryDatabase().get<ModelRow>(
    `SELECT ${SELECT_COLUMNS} FROM models WHERE id = ?`,
    [id],
  );
  return row ? toSavedModel(row) : undefined;
}

/** 取得一個模型；找不到時丟出 MODEL_NOT_FOUND（模型可能已被刪除，由呼叫端提示使用者重新選擇）。 */
export function requireModel(id: string, interfaceName: string): SavedModel {
  const model = findModel(id);
  if (model) return model;
  throw createError(
    MODULE_NAME,
    interfaceName,
    ModelStoreErrorCodes.MODEL_NOT_FOUND,
    `找不到編號為 ${id} 的模型，可能已經被刪除`,
    { id },
  );
}

// ===== 新增 =====

/**
 * 把測試成功的模型存起來：能力、可調參數跟著模型存下（spec 規則）。
 * 顯示名稱空白時丟出 MODEL_NAME_REQUIRED；價格是負數或不是數字時丟出 MODEL_PRICE_INVALID。
 */
export function insertModel(input: ModelToInsert, interfaceName: string): SavedModel {
  const displayName = requireDisplayName(input.displayName, interfaceName);
  const model: SavedModel = {
    id: randomUUID(),
    type: input.detected.type,
    provider: input.connection.provider,
    modelId: input.detected.id,
    displayName,
    keyId: input.connection.keyId,
    address: input.connection.address,
    price: normalizePrice(input.price, input.detected, input.connection.provider, interfaceName),
    capabilities: input.detected.capabilities ?? null,
    params: input.detected.params,
  };
  const now = new Date().toISOString();
  openRegistryDatabase().run(
    `INSERT INTO models (${SELECT_COLUMNS}, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      model.id,
      model.type,
      model.provider,
      model.modelId,
      model.displayName,
      model.keyId,
      model.address,
      JSON.stringify(model.price),
      model.capabilities ? JSON.stringify(model.capabilities) : null,
      JSON.stringify(model.params),
      now,
      now,
    ],
  );
  return model;
}

// ===== 換 key =====

/**
 * 替模型換一組 key，回傳換好的模型。
 * 找不到模型時丟出 MODEL_NOT_FOUND；key 是別家供應商的時丟出 MODEL_KEY_PROVIDER_MISMATCH；key 不存在時丟出 API_KEY_NOT_FOUND。
 */
export function updateModelKey(id: string, keyId: string): SavedModel {
  const interfaceName = 'updateModelKey';
  const database = openRegistryDatabase();
  return database.transaction(() => {
    const model = requireModel(id, interfaceName);
    checkKeyForProvider(keyId, model.provider, interfaceName);
    database.run('UPDATE models SET key_id = ?, updated_at = ? WHERE id = ?', [
      keyId,
      new Date().toISOString(),
      id,
    ]);
    return { ...model, keyId };
  });
}

// ===== 刪除 =====

/** 刪除一個模型，回傳刪除前的內容。找不到時丟出 MODEL_NOT_FOUND。 */
export function deleteModel(id: string): SavedModel {
  const interfaceName = 'deleteModel';
  const database = openRegistryDatabase();
  return database.transaction(() => {
    const model = requireModel(id, interfaceName);
    database.run('DELETE FROM models WHERE id = ?', [id]);
    return model;
  });
}

// ===== 價格 =====

/**
 * 只留這個類型用得到的價格欄位：Forge 不計費；LLM 只填了輸入或輸出其中一個時，另一個當 0；
 * 網頁搜尋「不支援」或 OpenRouter（直接用它回報的金額）不存每次搜尋價格。
 */
function normalizePrice(
  price: ModelPrice,
  detected: DetectedModel,
  provider: ProviderId,
  interfaceName: string,
): ModelPrice {
  if (provider === FORGE_PROVIDER) return {};
  if (detected.type !== 'llm') return pickPrices(price, ['perUnit'], interfaceName);

  const tokenPrice = pickPrices(price, [...LLM_TOKEN_PRICE_FIELDS], interfaceName);
  const hasTokenPrice = Object.keys(tokenPrice).length > 0;
  const normalized: ModelPrice = hasTokenPrice
    ? { inputPerMillionTokens: 0, outputPerMillionTokens: 0, ...tokenPrice }
    : {};
  const hasSearchPrice =
    detected.capabilities?.webSearch !== 'no' && provider !== PROVIDER_REPORTING_SEARCH_COST;
  if (hasSearchPrice) Object.assign(normalized, pickPrices(price, ['perSearch'], interfaceName));
  return normalized;
}

/** 取出指定的價格欄位；沒填的略過，負數或不是數字時丟出 MODEL_PRICE_INVALID（spec：價格不能是負數）。 */
function pickPrices(
  price: ModelPrice,
  fields: (keyof ModelPrice)[],
  interfaceName: string,
): ModelPrice {
  const picked: ModelPrice = {};
  for (const field of fields) {
    const value = price[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw createError(
        MODULE_NAME,
        interfaceName,
        ModelStoreErrorCodes.MODEL_PRICE_INVALID,
        `價格「${field}」要是 0 以上的數字`,
        { field, value },
      );
    }
    picked[field] = value;
  }
  return picked;
}

// ===== 輔助 =====

function requireDisplayName(displayName: string, interfaceName: string): string {
  const trimmed = displayName.trim();
  if (trimmed) return trimmed;
  throw createError(
    MODULE_NAME,
    interfaceName,
    ModelStoreErrorCodes.MODEL_NAME_REQUIRED,
    '模型的顯示名稱是空的',
  );
}

function toSavedModel(row: ModelRow): SavedModel {
  return {
    id: row.id,
    type: row.type,
    provider: row.provider,
    modelId: row.model_id,
    displayName: row.display_name,
    keyId: row.key_id,
    address: row.address,
    price: JSON.parse(row.price) as ModelPrice,
    capabilities: row.capabilities ? (JSON.parse(row.capabilities) as LlmCapabilities) : null,
    params: JSON.parse(row.params) as ParamDefinition[],
  };
}
