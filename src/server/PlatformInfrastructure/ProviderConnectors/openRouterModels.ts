// OpenRouter 的模型偵測：用 /api/v1/models 列出輸出文字的模型；能力由支援的參數、輸入類型推得，價格自動帶入。
// 也定義 OpenRouter 回報、平台另外列出的可調參數（送出對話時由 openRouter.ts 轉回 API 欄位）。

import type {
  CapabilitySupport,
  DetectedModel,
  LlmCapabilities,
  ModelPrice,
  ParamDefinition,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { asArray, asRecord, asString, buildCommonParams, toLimit } from './chatHelpers.ts';
import { classifyByStatus, requestProviderJson } from './providerRequest.ts';
import { authorizationHeader } from './responsesApiFormat.ts';

const MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=text';
const SITE_URL = 'https://openrouter.ai';
const TEMPERATURE_RANGE = { min: 0, max: 2 };
const DEFAULT_REASONING_EFFORTS = ['low', 'medium', 'high'];
// 模型清單分頁的保險上限，避免 next 連結出錯時無限讀取
const MAX_MODEL_PAGES = 50;
// 美元 / token → 美元 / 100 萬 token
const TOKENS_PER_MILLION = 1_000_000;

type JsonObject = Record<string, unknown>;

/** OpenRouter 回報、平台另外列出的可調參數：API 名稱 → 平台的參數定義（範圍依 OpenRouter 文件）。 */
export const OPENROUTER_EXTRA_PARAMS: Array<{ apiName: string; definition: ParamDefinition }> = [
  { apiName: 'top_p', definition: { key: 'topP', kind: 'number', min: 0, max: 1 } },
  { apiName: 'top_k', definition: { key: 'topK', kind: 'number', min: 0, isInteger: true } },
  {
    apiName: 'frequency_penalty',
    definition: { key: 'frequencyPenalty', kind: 'number', min: -2, max: 2 },
  },
  {
    apiName: 'presence_penalty',
    definition: { key: 'presencePenalty', kind: 'number', min: -2, max: 2 },
  },
  {
    apiName: 'repetition_penalty',
    definition: { key: 'repetitionPenalty', kind: 'number', min: 0, max: 2 },
  },
  { apiName: 'min_p', definition: { key: 'minP', kind: 'number', min: 0, max: 1 } },
  { apiName: 'top_a', definition: { key: 'topA', kind: 'number', min: 0, max: 1 } },
  { apiName: 'seed', definition: { key: 'seed', kind: 'number', isInteger: true } },
];

// ===== 偵測模型 =====

/** 列出輸出文字的模型（含分頁）。 */
export async function listOpenRouterChatModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<DetectedModel[]> {
  const models: JsonObject[] = [];
  let url: string | undefined = MODELS_URL;
  for (let page = 0; url && page < MAX_MODEL_PAGES; page += 1) {
    const body: JsonObject = await requestProviderJson<JsonObject>({
      provider: 'openrouter',
      interfaceName: 'listChatModels',
      url,
      headers: authorizationHeader(apiKey),
      apiKey,
      signal,
      classifyError: classifyByStatus,
    });
    models.push(...asArray(body.data).map(asRecord));
    url = nextPageUrl(asRecord(body.links).next);
  }
  return models.map(toDetectedModel);
}

function nextPageUrl(next: unknown): string | undefined {
  const link = asString(next);
  if (!link) return undefined;
  return link.startsWith('http') ? link : `${SITE_URL}${link}`;
}

function toDetectedModel(model: JsonObject): DetectedModel {
  const supported = Array.isArray(model.supported_parameters)
    ? model.supported_parameters.map(asString)
    : undefined;
  const capabilities = readCapabilities(model, supported);
  const efforts = asArray(asRecord(model.reasoning).supported_efforts).map(asString);
  const params = buildCommonParams(capabilities, {
    hasMaxOutputTokens: hasAny(supported, ['max_tokens', 'max_completion_tokens']),
    temperatureRange: hasAny(supported, ['temperature']) ? TEMPERATURE_RANGE : undefined,
    reasoningEfforts: efforts.length > 0 ? efforts : DEFAULT_REASONING_EFFORTS,
  });
  for (const { apiName, definition } of OPENROUTER_EXTRA_PARAMS) {
    if (hasAny(supported, [apiName])) params.push(definition);
  }
  const detected: DetectedModel = {
    id: asString(model.id),
    displayName: asString(model.name) || asString(model.id),
    type: 'llm',
    capabilities,
    params,
  };
  const description = asString(model.description);
  if (description) detected.description = description;
  const price = readPrice(asRecord(model.pricing));
  if (price) detected.price = price;
  return detected;
}

function readCapabilities(model: JsonObject, supported: string[] | undefined): LlmCapabilities {
  const architecture = asRecord(model.architecture);
  const inputs = Array.isArray(architecture.input_modalities)
    ? architecture.input_modalities.map(asString)
    : undefined;
  return {
    imageInput: listSupport(inputs, 'image'),
    fileInput: listSupport(inputs, 'file'),
    // OpenRouter 的網頁搜尋工具適用所有模型（模型沒有原生搜尋時改用 Exa）
    webSearch: 'yes',
    thinking: listSupport(supported, 'reasoning'),
    tools: listSupport(supported, 'tools'),
    contextWindow: toLimit(model.context_length),
    maxOutputTokens: toLimit(asRecord(model.top_provider).max_completion_tokens),
  };
}

/** 價格是「美元 / token」的文字；負數（自動路由的動態價格）代表沒有固定價格。 */
function readPrice(pricing: JsonObject): ModelPrice | undefined {
  const input = Number.parseFloat(asString(pricing.prompt));
  const output = Number.parseFloat(asString(pricing.completion));
  const isFixedPrice =
    Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0;
  if (!isFixedPrice) return undefined;
  return {
    inputPerMillionTokens: roundPrice(input * TOKENS_PER_MILLION),
    outputPerMillionTokens: roundPrice(output * TOKENS_PER_MILLION),
  };
}

// ===== 輔助 =====

/** 清單有提供時，有列出就是支援、沒列出就是不支援；清單沒提供時為未知。 */
function listSupport(list: string[] | undefined, item: string): CapabilitySupport {
  if (!list) return 'unknown';
  return list.includes(item) ? 'yes' : 'no';
}

/** 浮點數換算後去掉多餘的小數誤差（例如 2.9999999999999996）。 */
function roundPrice(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function hasAny(supported: string[] | undefined, names: string[]): boolean {
  return supported !== undefined && names.some((name) => supported.includes(name));
}
