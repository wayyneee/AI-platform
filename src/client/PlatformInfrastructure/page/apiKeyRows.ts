// API key 分頁的每一列：從已儲存的 key 建立、新增空白列、判斷有沒有修改、檢查必填、套用儲存結果。
// 只處理資料，不碰畫面和後端，方便 ApiKeyPanel 依步驟組合。

import type {
  ApiKeySummary,
  PlatformError,
  ProviderId,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { getText } from '../ThemeAndLanguage/index.ts';

export type KeyField = 'provider' | 'name' | 'keyValue';

/** 畫面上的一列；saved 為空代表還沒儲存的新列。 */
export interface KeyRow {
  rowId: string;
  saved?: ApiKeySummary;
  provider: ProviderId | '';
  name: string;
  /** 新列為要新增的 key；已儲存的列輸入新值代表換 key，空白代表不變 */
  keyValue: string;
  invalidFields: KeyField[];
  errorText: string;
}

/** 一列送出後的結果。 */
export type RowSaveResult = { key: ApiKeySummary } | { error: PlatformError };

// 後端回報的錯誤對應到要紅框的欄位；其他錯誤（例如連不上）整列紅框
const ERROR_FIELDS: Record<string, KeyField[]> = {
  API_KEY_NAME_TAKEN: ['name'],
  API_KEY_NAME_REQUIRED: ['name'],
  API_KEY_VALUE_REQUIRED: ['keyValue'],
  API_KEY_PROVIDER_INVALID: ['provider'],
};

let newRowCount = 0;

// ===== 建立 =====

/** 已儲存的 key 變成一列：名稱帶入，key 欄位空白（提示文字顯示遮罩值）。 */
export function createSavedRow(key: ApiKeySummary): KeyRow {
  return {
    rowId: key.id,
    saved: key,
    provider: key.provider,
    name: key.name,
    keyValue: '',
    invalidFields: [],
    errorText: '',
  };
}

/** 新的空白列；供應商、名稱、key 都要填。 */
export function createNewRow(): KeyRow {
  newRowCount += 1;
  return {
    rowId: `new-${newRowCount}`,
    provider: '',
    name: '',
    keyValue: '',
    invalidFields: [],
    errorText: '',
  };
}

// ===== 判斷 =====

/** 新列一律算修改；已儲存的列名稱改了或輸入了新 key 才算（改回原樣就不算）。 */
export function isRowChanged(row: KeyRow): boolean {
  if (!row.saved) return true;
  return row.name !== row.saved.name || row.keyValue !== '';
}

// ===== 編輯 =====

/** 改了某個欄位：拿掉那個欄位的紅框；紅框都拿掉後，列下方的錯誤文字也一起拿掉。 */
export function changeRowField(row: KeyRow, field: KeyField, value: string): KeyRow {
  const invalidFields = row.invalidFields.filter((invalid) => invalid !== field);
  return {
    ...row,
    [field]: value,
    invalidFields,
    errorText: invalidFields.length > 0 ? row.errorText : '',
  };
}

// ===== 儲存 =====

/** 檢查必填：新列要有供應商、名稱、key；已儲存的列要有名稱。不符合的欄位紅框。 */
export function checkRequiredFields(row: KeyRow): KeyRow {
  const missing: KeyField[] = [];
  if (!row.saved && !row.provider) missing.push('provider');
  if (!row.name.trim()) missing.push('name');
  if (!row.saved && !row.keyValue.trim()) missing.push('keyValue');
  return {
    ...row,
    invalidFields: missing,
    errorText: missing.length > 0 ? getText('PlatformInfrastructure.apiKeys.rowRequired') : '',
  };
}

/** 套用送出的結果：成功變成乾淨的已儲存列（只留遮罩值）；失敗保留輸入內容，紅框並顯示白話說明。 */
export function applySaveResult(row: KeyRow, result: RowSaveResult | undefined): KeyRow {
  if (!result) return row;
  if ('key' in result) return createSavedRow(result.key);
  return {
    ...row,
    invalidFields: ERROR_FIELDS[result.error.code] ?? editableFields(row),
    errorText: getText(`errors.${result.error.code}`),
  };
}

/** 把儲存成功的 key 放進已儲存的清單：修改的換掉，新增的加在最後（和後端列出的先後一致）。 */
export function mergeSavedKeys(
  keys: ApiKeySummary[],
  results: Map<string, RowSaveResult>,
): ApiKeySummary[] {
  const merged = [...keys];
  for (const result of results.values()) {
    if (!('key' in result)) continue;
    const index = merged.findIndex((key) => key.id === result.key.id);
    if (index >= 0) merged[index] = result.key;
    else merged.push(result.key);
  }
  return merged;
}

// ===== 輔助 =====

function editableFields(row: KeyRow): KeyField[] {
  return row.saved ? ['name', 'keyValue'] : ['provider', 'name', 'keyValue'];
}
