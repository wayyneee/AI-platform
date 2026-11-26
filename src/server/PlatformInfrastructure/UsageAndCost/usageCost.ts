// 花費計算：花費 = 用量 × 模型儲存的價格；沒填價格的用量只統計、不算進花費（spec 規則）。

import type {
  LlmUsage,
  MediaUsage,
  ModelPrice,
  ModelType,
  UsageAmounts,
} from '../../../shared/PlatformInfrastructure/types.ts';

// 價格的單位：LLM 每 100 萬 token、語音每 100 萬字（spec 規則）
const PER_MILLION = 1_000_000;

/** 計算花費要用到的模型資訊。 */
export interface PricedModel {
  type: ModelType;
  price: ModelPrice;
}

/** 計算過程中的一項用量：多少，以及算出來的花費（null 代表沒填價格）。 */
interface CostPart {
  amount: number;
  cost: number | null;
}

// ===== 主要流程 =====

/** 把一次呼叫的用量換成統計用的數字，並依模型價格算出花費。 */
export function calculateUsage(model: PricedModel, usage: LlmUsage | MediaUsage): UsageAmounts {
  const amounts =
    model.type === 'llm'
      ? llmAmounts(usage as LlmUsage)
      : mediaAmounts(model.type, usage as MediaUsage);
  const parts =
    model.type === 'llm'
      ? llmCostParts(model.price, usage as LlmUsage)
      : [mediaCostPart(model, amounts)];
  return { ...amounts, ...sumCostParts(parts) };
}

// ===== LLM =====

function llmAmounts(usage: LlmUsage) {
  return {
    ...emptyAmounts(),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    searchCount: usage.searchCount,
  };
}

/** LLM：token（輸入、輸出分開計價）加上網頁搜尋。 */
function llmCostParts(price: ModelPrice, usage: LlmUsage): CostPart[] {
  return [tokenCostPart(price, usage), searchCostPart(price, usage)];
}

/** token：輸入或輸出有填價格就算；ModelRegistry 存價格時，只填一個的另一個已存成 0。 */
function tokenCostPart(price: ModelPrice, usage: LlmUsage): CostPart {
  const amount = usage.inputTokens + usage.outputTokens;
  const hasPrice =
    price.inputPerMillionTokens !== undefined || price.outputPerMillionTokens !== undefined;
  if (!hasPrice) return { amount, cost: null };
  const inputCost = (usage.inputTokens * (price.inputPerMillionTokens ?? 0)) / PER_MILLION;
  const outputCost = (usage.outputTokens * (price.outputPerMillionTokens ?? 0)) / PER_MILLION;
  return { amount, cost: inputCost + outputCost };
}

/**
 * 網頁搜尋的手續費不在 token 裡（spec 規則）：供應商有回報金額時直接用（OpenRouter），
 * 否則為搜尋次數 × 每次搜尋價格；兩者都沒有時只統計次數。
 */
function searchCostPart(price: ModelPrice, usage: LlmUsage): CostPart {
  const amount = usage.searchCount;
  if (usage.reportedSearchCostUsd !== undefined) {
    return { amount, cost: usage.reportedSearchCostUsd };
  }
  if (price.perSearch === undefined) return { amount, cost: null };
  return { amount, cost: amount * price.perSearch };
}

// ===== 圖片、影片、語音 =====

/** 只記下這個類型的計費單位：圖片以張、影片以秒、語音以輸入字數。 */
function mediaAmounts(type: ModelType, usage: MediaUsage) {
  const amounts = emptyAmounts();
  if (type === 'image') amounts.imageCount = usage.imageCount;
  if (type === 'video') amounts.videoSeconds = usage.videoSeconds;
  if (type === 'audio') amounts.characterCount = usage.characterCount;
  return amounts;
}

function mediaCostPart(model: PricedModel, amounts: ReturnType<typeof emptyAmounts>): CostPart {
  const amount = amounts.imageCount + amounts.videoSeconds + amounts.characterCount;
  if (model.price.perUnit === undefined) return { amount, cost: null };
  // 語音的價格是每 100 萬字，圖片、影片是每張、每秒
  const perUnit = model.type === 'audio' ? model.price.perUnit / PER_MILLION : model.price.perUnit;
  return { amount, cost: amount * perUnit };
}

// ===== 輔助 =====

/** 加總各項花費；用量是 0 的項目不影響「有沒有價格」的判斷。 */
function sumCostParts(parts: CostPart[]) {
  let costUsd = 0;
  let hasPricedUsage = false;
  let hasUnpricedUsage = false;
  for (const part of parts) {
    if (part.amount <= 0) continue;
    if (part.cost === null) {
      hasUnpricedUsage = true;
      continue;
    }
    costUsd += part.cost;
    hasPricedUsage = true;
  }
  return { costUsd, hasPricedUsage, hasUnpricedUsage };
}

function emptyAmounts() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    searchCount: 0,
    imageCount: 0,
    videoSeconds: 0,
    characterCount: 0,
  };
}
