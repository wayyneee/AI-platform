// 模型的顯示文字：價格、token 數量、能力摘要與能力清單、可輸入輸出的類型。
// 模型分頁和新增模型視窗共用，只產生文字，不碰畫面。

import type {
  CapabilitySupport,
  ContentKind,
  DetectedModel,
  LlmCapabilities,
  ModelPrice,
  ModelType,
  ProviderId,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { getText } from '../ThemeAndLanguage/index.ts';

const FORGE_PROVIDER: ProviderId = 'forge';
// 小於這個金額時照原樣顯示（例如 $0.039），不四捨五入到兩位
const SMALL_PRICE = 0.1;
const MILLION = 1_000_000;
const THOUSAND = 1_000;

/** 能力清單的順序：兩個上限放前面，其他模組安排對話長度、調整輸出長度最常用到。 */
const SUPPORT_CAPABILITIES = ['imageInput', 'fileInput', 'webSearch', 'thinking', 'tools'] as const;

type SupportCapability = (typeof SUPPORT_CAPABILITIES)[number];

/** 資訊卡的一項：名稱、顯示文字、狀態（決定顏色；沒有狀態的不上色）。 */
export interface InfoItem {
  label: string;
  value: string;
  support?: CapabilitySupport;
}

// ===== 價格 =====

/** 金額，例如 $3.00、$0.039。 */
export function formatMoney(value: number): string {
  return `$${value < SMALL_PRICE ? String(value) : value.toFixed(2)}`;
}

/** 模型列的價格文字：主要一行和下方的小字；沒有價格時 isUnset 為 true。 */
export function describeModelPrice(
  type: ModelType,
  provider: ProviderId,
  price: ModelPrice,
): { text: string; note?: string; isUnset: boolean } {
  if (provider === FORGE_PROVIDER) {
    return { text: getText('PlatformInfrastructure.models.forgeFree'), isUnset: true };
  }
  if (type === 'llm' && price.inputPerMillionTokens !== undefined) {
    const search =
      price.perSearch !== undefined
        ? getText('PlatformInfrastructure.models.priceSearch', {
            price: formatMoney(price.perSearch),
          })
        : '';
    const tokens = getText('PlatformInfrastructure.models.priceLlm', {
      input: formatMoney(price.inputPerMillionTokens),
      output: formatMoney(price.outputPerMillionTokens ?? 0),
    });
    return {
      text: tokens + search,
      note: getText('PlatformInfrastructure.models.priceTokenUnit'),
      isUnset: false,
    };
  }
  if (type !== 'llm' && price.perUnit !== undefined) {
    const text = getText(`PlatformInfrastructure.models.priceUnit.${type}`, {
      price: formatMoney(price.perUnit),
    });
    return { text, isUnset: false };
  }
  return { text: getText('PlatformInfrastructure.models.priceUnset'), isUnset: true };
}

// ===== token 數量 =====

/** token 數量的簡寫，例如 128000 → 128K、1000000 → 1M。 */
export function formatTokenCount(count: number): string {
  if (count >= MILLION) return `${trimDecimal(count / MILLION)}M`;
  if (count >= THOUSAND) return `${Math.round(count / THOUSAND)}K`;
  return String(count);
}

// ===== 能力 =====

/**
 * 偵測結果選項下方的提示小字。LLM 只列支援的項目，例如「context 128K・圖片・思考・工具」；
 * 其他類型列出可輸入的類型。
 */
export function summarizeModel(model: DetectedModel): string {
  if (!model.capabilities) {
    if (!model.inputKinds?.length) return '';
    return getText('PlatformInfrastructure.addModel.summaryInput', {
      kinds: joinKinds(model.inputKinds),
    });
  }
  const capabilities = model.capabilities;
  const parts: string[] = [];
  if (capabilities.contextWindow !== null) {
    parts.push(
      getText('PlatformInfrastructure.addModel.summaryContext', {
        count: formatTokenCount(capabilities.contextWindow),
      }),
    );
  }
  for (const capability of SUPPORT_CAPABILITIES) {
    if (capabilities[capability] === 'yes') {
      parts.push(getText(`PlatformInfrastructure.capabilityShort.${capability}`));
    }
  }
  if (parts.length === 0) return getText('PlatformInfrastructure.addModel.summaryNone');
  return parts.join(getText('PlatformInfrastructure.common.summarySeparator'));
}

/** 資訊卡的七項能力：context window 上限、輸出上限、傳圖片、傳檔案、網頁搜尋、思考、調用工具。 */
export function listCapabilityItems(capabilities: LlmCapabilities): InfoItem[] {
  return [
    limitItem('contextWindow', capabilities.contextWindow),
    limitItem('maxOutputTokens', capabilities.maxOutputTokens),
    ...SUPPORT_CAPABILITIES.map((capability) => supportItem(capability, capabilities[capability])),
  ];
}

/** 圖片、影片、語音的資訊卡：可輸入、可輸出的類型（有資料才顯示）。 */
export function listMediaItems(model: DetectedModel): InfoItem[] {
  const items: InfoItem[] = [];
  if (model.inputKinds?.length) {
    items.push({
      label: getText('PlatformInfrastructure.addModel.inputKinds'),
      value: joinKinds(model.inputKinds),
    });
  }
  if (model.outputKinds?.length) {
    items.push({
      label: getText('PlatformInfrastructure.addModel.outputKinds'),
      value: joinKinds(model.outputKinds),
    });
  }
  return items;
}

// ===== 輔助 =====

function limitItem(
  capability: 'contextWindow' | 'maxOutputTokens',
  limit: number | null,
): InfoItem {
  const label = getText(`PlatformInfrastructure.capability.${capability}`);
  if (limit === null) {
    return { label, value: getText('PlatformInfrastructure.support.unknown'), support: 'unknown' };
  }
  const value = getText('PlatformInfrastructure.addModel.tokenLimit', {
    count: formatTokenCount(limit),
  });
  return { label, value, support: 'yes' };
}

function supportItem(capability: SupportCapability, support: CapabilitySupport): InfoItem {
  return {
    label: getText(`PlatformInfrastructure.capability.${capability}`),
    value: getText(`PlatformInfrastructure.support.${support}`),
    support,
  };
}

function joinKinds(kinds: ContentKind[]): string {
  return kinds
    .map((kind) => getText(`PlatformInfrastructure.contentKind.${kind}`))
    .join(getText('PlatformInfrastructure.common.listSeparator'));
}

/** 最多一位小數，整數不帶 .0，例如 1.048 → 1、1.5 → 1.5。 */
function trimDecimal(value: number): string {
  return String(Math.round(value * 10) / 10);
}
