// 新增模型視窗的表單狀態：四步（供應商 → 連線 → 模型 → 名稱與價格）怎麼互相影響、哪一步能操作、價格欄位與檢查。
// 只處理資料，不碰畫面和後端，方便 AddModelDialog 依步驟組合。

import type {
  DetectedModel,
  ModelPrice,
  ModelType,
  NewModel,
  ProviderId,
} from '../../../shared/PlatformInfrastructure/types.ts';

const FORGE_PROVIDER: ProviderId = 'forge';
// OpenRouter 直接用它回報的搜尋金額，不用填每次搜尋價格（page.md）
const PROVIDER_REPORTING_SEARCH_COST: ProviderId = 'openrouter';

export type PriceField = keyof ModelPrice;
export type StepName = 'provider' | 'connection' | 'model' | 'details';

/** 偵測的狀態：還沒偵測、偵測中、完成（模型清單）、失敗（白話說明）。 */
export type DetectState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; models: DetectedModel[] }
  | { status: 'failed'; errorText: string };

export type TestState = 'none' | 'running' | 'success' | 'failed';

export interface AddModelForm {
  provider: ProviderId | '';
  keyId: string;
  address: string;
  detect: DetectState;
  modelId: string;
  displayName: string;
  /** 畫面上的價格欄位（文字）；空字串代表沒填 */
  prices: Partial<Record<PriceField, string>>;
  /** 自動帶入的價格；欄位值和它相同時顯示「已自動帶入」 */
  autoPrices: Partial<Record<PriceField, string>>;
  test: TestState;
}

// ===== 建立 =====

/** 剛打開的樣子：什麼都還沒選。 */
export function createEmptyForm(): AddModelForm {
  return {
    provider: '',
    keyId: '',
    address: '',
    detect: { status: 'idle' },
    modelId: '',
    displayName: '',
    prices: {},
    autoPrices: {},
    test: 'none',
  };
}

// ===== 每一步的修改 =====

/** 換供應商 → 清空後面所有步驟（選回未選也一樣）。 */
export function chooseProvider(provider: ProviderId | ''): AddModelForm {
  return { ...createEmptyForm(), provider };
}

/** 換 key → 清空模型；有選 key 時接著偵測（偵測由畫面發出）。 */
export function chooseKey(form: AddModelForm, keyId: string): AddModelForm {
  return { ...clearFromModel(form), keyId };
}

/** 改 Forge 位址 → 清空模型，要重新按偵測。 */
export function changeAddress(form: AddModelForm, address: string): AddModelForm {
  return { ...clearFromModel(form), address };
}

/** 開始偵測：模型那一步顯示讀取中。 */
export function startDetecting(form: AddModelForm): AddModelForm {
  return { ...clearFromModel(form), detect: { status: 'loading' } };
}

/** 選模型 → 顯示名稱帶入模型的顯示名稱，抓得到的價格自動帶入，要重新測試。 */
export function chooseModel(form: AddModelForm, model: DetectedModel | undefined): AddModelForm {
  const autoPrices = model?.price ? toPriceTexts(model.price) : {};
  return {
    ...form,
    modelId: model?.id ?? '',
    displayName: model?.displayName ?? '',
    prices: { ...autoPrices },
    autoPrices,
    test: 'none',
  };
}

// ===== 判斷 =====

/** 前一步完成後下一步才能操作。 */
export function isStepEnabled(form: AddModelForm, step: StepName): boolean {
  if (step === 'provider') return true;
  if (step === 'connection') return form.provider !== '';
  if (step === 'model') return isStepDone(form, 'connection');
  return form.modelId !== '';
}

export function isStepDone(form: AddModelForm, step: StepName): boolean {
  if (step === 'provider') return form.provider !== '';
  // Forge 按過偵測才算完成（失敗時模型那一步會提示先連上）
  if (step === 'connection') {
    return form.provider === FORGE_PROVIDER ? form.detect.status !== 'idle' : form.keyId !== '';
  }
  if (step === 'model') return form.modelId !== '';
  return form.test === 'success';
}

/** 選了供應商就算有修改；選回「-- 請選擇 --」等於回到剛打開的樣子。 */
export function isFormDirty(form: AddModelForm): boolean {
  return form.provider !== '';
}

/** 選中的模型（偵測結果裡的那一個）。 */
export function findChosenModel(form: AddModelForm): DetectedModel | undefined {
  if (form.detect.status !== 'done') return undefined;
  return form.detect.models.find((model) => model.id === form.modelId);
}

// ===== 價格 =====

/**
 * 這個類型要顯示哪些價格欄位：Forge 不計費；LLM 輸入、輸出，網頁搜尋不是「不支援」時多每次搜尋價格
 * （OpenRouter 不顯示）；其他類型一個單位價格。
 */
export function listPriceFields(type: ModelType, form: AddModelForm): PriceField[] {
  if (form.provider === FORGE_PROVIDER) return [];
  if (type !== 'llm') return ['perUnit'];
  const fields: PriceField[] = ['inputPerMillionTokens', 'outputPerMillionTokens'];
  const model = findChosenModel(form);
  const hasSearch = model?.capabilities?.webSearch !== 'no';
  if (hasSearch && form.provider !== PROVIDER_REPORTING_SEARCH_COST) fields.push('perSearch');
  return fields;
}

/** 價格不能是負數；沒填不算錯。 */
export function isPriceInvalid(text: string | undefined): boolean {
  if (text === undefined || text.trim() === '') return false;
  const value = Number(text);
  return !Number.isFinite(value) || value < 0;
}

/** 儲存按鈕能不能按：測試成功、顯示名稱有填、價格沒有錯。 */
export function canSave(type: ModelType, form: AddModelForm): boolean {
  const hasInvalidPrice = listPriceFields(type, form).some((field) =>
    isPriceInvalid(form.prices[field]),
  );
  return form.test === 'success' && form.displayName.trim() !== '' && !hasInvalidPrice;
}

/** 組出要送給後端的新增內容：只送畫面上有的價格欄位，沒填的不送。 */
export function buildNewModel(type: ModelType, form: AddModelForm): NewModel {
  const price: ModelPrice = {};
  for (const field of listPriceFields(type, form)) {
    const text = form.prices[field]?.trim();
    if (text) price[field] = Number(text);
  }
  return {
    ...buildConnection(type, form),
    modelId: form.modelId,
    displayName: form.displayName.trim(),
    price,
  };
}

/** 偵測、測試要送的連線：雲端供應商送 key 編號，Forge 送位址。 */
export function buildConnection(type: ModelType, form: AddModelForm) {
  const provider = form.provider as ProviderId;
  return provider === FORGE_PROVIDER
    ? { type, provider, address: form.address.trim() }
    : { type, provider, keyId: form.keyId };
}

// ===== 輔助 =====

/** 清空模型和它後面的步驟；連線設定保留。 */
function clearFromModel(form: AddModelForm): AddModelForm {
  return {
    ...form,
    detect: { status: 'idle' },
    modelId: '',
    displayName: '',
    prices: {},
    autoPrices: {},
    test: 'none',
  };
}

function toPriceTexts(price: ModelPrice): Partial<Record<PriceField, string>> {
  const texts: Partial<Record<PriceField, string>> = {};
  for (const [field, value] of Object.entries(price) as [PriceField, number | undefined][]) {
    if (value !== undefined) texts[field] = String(value);
  }
  return texts;
}
