// 各家串接共用的小工具：讀參數、組可調參數定義、附件轉 data URL、解析工具內容、整理搜尋來源、判斷 replay 能不能用。

import {
  LLM_PARAM_KEYS,
  type ChatAttachment,
  type LlmCapabilities,
  type ParamDefinition,
  type ParamValues,
  type ProviderId,
  type ProviderReplay,
  type SearchSource,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { createProviderError, type ProviderCallContext } from './providerRequest.ts';

// ===== 讀參數 =====

/** 讀數字參數；沒填或型別不對時回傳 undefined（交給供應商決定）。 */
export function readNumberParam(params: ParamValues, key: string): number | undefined {
  const value = params[key];
  return typeof value === 'number' ? value : undefined;
}

/** 讀文字參數（例如思考程度）。 */
export function readStringParam(params: ParamValues, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** 網頁搜尋是否開啟；沒填視為關閉。 */
export function isWebSearchOn(params: ParamValues): boolean {
  return params[LLM_PARAM_KEYS.webSearch] === true;
}

// ===== 可調參數定義 =====

/** 組可調參數時，各家要加哪些共通參數。 */
export interface CommonParamOptions {
  hasMaxOutputTokens: boolean;
  /** 有溫度參數時的範圍 */
  temperatureRange?: { min: number; max: number };
  /** 思考程度的選項；沒有就不列 */
  reasoningEfforts?: string[];
}

/**
 * 組出共通的可調參數：回應長度、溫度、思考程度、網頁搜尋。
 * spec：支援思考的模型才有「思考程度」；網頁搜尋不是「不支援」的模型才有「網頁搜尋」。
 */
export function buildCommonParams(
  capabilities: LlmCapabilities,
  options: CommonParamOptions,
): ParamDefinition[] {
  const params: ParamDefinition[] = [];
  if (options.hasMaxOutputTokens) {
    params.push({
      key: LLM_PARAM_KEYS.maxOutputTokens,
      kind: 'number',
      min: 1,
      max: capabilities.maxOutputTokens ?? undefined,
      isInteger: true,
    });
  }
  if (options.temperatureRange) {
    params.push({ key: LLM_PARAM_KEYS.temperature, kind: 'number', ...options.temperatureRange });
  }
  if (capabilities.thinking === 'yes' && options.reasoningEfforts?.length) {
    params.push({
      key: LLM_PARAM_KEYS.reasoningEffort,
      kind: 'select',
      options: options.reasoningEfforts,
    });
  }
  if (capabilities.webSearch !== 'no') {
    params.push({ key: LLM_PARAM_KEYS.webSearch, kind: 'boolean', default: false });
  }
  return params;
}

/** 由「有沒有提供這項資料」轉成能力狀態：沒提供一律未知（spec：不自己猜）。 */
export function toSupport(value: boolean | undefined): 'yes' | 'no' | 'unknown' {
  if (value === undefined) return 'unknown';
  return value ? 'yes' : 'no';
}

/** 數字欄位：是正數才採用，否則未知。 */
export function toLimit(value: unknown): number | null {
  return typeof value === 'number' && value > 0 ? value : null;
}

// ===== 對話內容 =====

/** 附件轉成 data URL（OpenAI、Grok、OpenRouter 的格式）。 */
export function toDataUrl(attachment: ChatAttachment): string {
  return `data:${attachment.mimeType};base64,${attachment.data}`;
}

/** PDF 沒給檔名時用的預設檔名。 */
export function attachmentFileName(attachment: ChatAttachment, index: number): string {
  return attachment.fileName ?? `document-${index + 1}.pdf`;
}

/** 這則回覆的 replay 是不是同一家、同一個模型產生的；不是就不能原樣送回。 */
export function isReplayFor(
  replay: ProviderReplay | undefined,
  provider: ProviderId,
  model: string,
): replay is ProviderReplay {
  return replay?.provider === provider && replay.model === model;
}

/** 解析模型送來的工具內容（JSON 字串）；格式不對時丟出 PROVIDER_RESPONSE_INVALID。 */
export function parseToolArguments(
  text: string,
  context: ProviderCallContext,
): Record<string, unknown> {
  if (text.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 落到下面統一丟出錯誤
  }
  throw createProviderError(context, 'PROVIDER_RESPONSE_INVALID', { toolArguments: text });
}

/** 去掉重複網址的搜尋來源，保留第一次出現的順序。 */
export function uniqueSources(sources: SearchSource[]): SearchSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (!source.url || seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

/** 把多段文字接起來，略過空白的段落。 */
export function joinParagraphs(parts: string[]): string {
  return parts.filter((part) => part.trim() !== '').join('\n\n');
}

/** 安全地讀物件欄位：值不是物件時回傳空物件，讓解析供應商回應時不用一直判斷。 */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** 安全地讀陣列：不是陣列時回傳空陣列。 */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 讀數字：不是數字時回傳 0（用量欄位缺少時視為 0）。 */
export function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** 讀文字：不是文字時回傳空字串。 */
export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
