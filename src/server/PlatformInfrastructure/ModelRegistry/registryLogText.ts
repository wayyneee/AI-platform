// ModelRegistry 寫 log 用的文字：供應商、類型的名稱和 key、模型的描述。
// log 的文字不做多語系（conventions.md 第 9 段），名稱直接寫在這裡。

import type {
  LlmUsage,
  ModelType,
  ProviderId,
} from '../../../shared/PlatformInfrastructure/types.ts';

const PROVIDER_LOG_NAMES: Record<ProviderId, string> = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  claude: 'Claude',
  grok: 'Grok',
  openrouter: 'OpenRouter',
  forge: 'Forge',
};

const TYPE_LOG_NAMES: Record<ModelType, string> = {
  llm: 'LLM',
  image: '圖片',
  video: '影片',
  audio: '語音',
};

/** 供應商的名稱，例如「OpenRouter」；不認得的供應商原樣顯示。 */
export function providerLogName(provider: ProviderId): string {
  return PROVIDER_LOG_NAMES[provider] ?? provider;
}

/** 一組 key 的描述，例如「個人（OpenRouter）」。 */
export function describeKey(provider: ProviderId, name: string): string {
  return `${name.trim()}（${providerLogName(provider)}）`;
}

/** 一個模型的描述，例如「GPT-5（OpenAI，LLM）」。 */
export function describeModel(name: string, provider: ProviderId, type: ModelType): string {
  return `${name.trim()}（${providerLogName(provider)}，${TYPE_LOG_NAMES[type] ?? type}）`;
}

/** LLM 用量的文字，例如「輸入 8 token、輸出 16 token」。 */
export function describeLlmUsage(usage: LlmUsage): string {
  return `輸入 ${usage.inputTokens} token、輸出 ${usage.outputTokens} token`;
}

/** 類型的名稱，例如「圖片」。 */
export function typeLogName(type: ModelType): string {
  return TYPE_LOG_NAMES[type] ?? type;
}
