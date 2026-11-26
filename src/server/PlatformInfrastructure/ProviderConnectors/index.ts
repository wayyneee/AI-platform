// ProviderConnectors 的唯一入口：依供應商取得它的串接。LLM 是偵測模型、送出對話、串流對話；
// 圖片、影片、語音是偵測模型、確認模型、查詢即時選項、生成。只給 ModelRegistry、ModelInvocation 使用。

import type { ProviderId } from '../../../shared/PlatformInfrastructure/types.ts';
import { claudeConnector } from './claude.ts';
import type { MediaConnector, ProviderConnector } from './connectorTypes.ts';
import { forgeConnector } from './forge.ts';
import { geminiConnector } from './gemini.ts';
import { grokConnector } from './grok.ts';
import { grokMediaConnector } from './grokMedia.ts';
import { openAiConnector } from './openAi.ts';
import { openRouterConnector } from './openRouter.ts';
import { openRouterMediaConnector } from './openRouterMedia.ts';

export type {
  ChatRequest,
  MediaConnection,
  MediaConnector,
  MediaRequest,
  ProviderConnector,
} from './connectorTypes.ts';
export { ProviderErrorCodes } from './providerRequest.ts';
export type { ProviderErrorCode } from './providerRequest.ts';

// spec：OpenAI、Gemini、Claude 只有 LLM；Forge 只有圖片
const CHAT_CONNECTORS: Partial<Record<ProviderId, ProviderConnector>> = {
  openai: openAiConnector,
  gemini: geminiConnector,
  claude: claudeConnector,
  grok: grokConnector,
  openrouter: openRouterConnector,
};

const MEDIA_CONNECTORS: Partial<Record<ProviderId, MediaConnector>> = {
  grok: grokMediaConnector,
  openrouter: openRouterMediaConnector,
  forge: forgeConnector,
};

/** 取得提供 LLM 的供應商串接；這家沒有 LLM（例如 Forge）時回傳 undefined。 */
export function getChatConnector(provider: ProviderId): ProviderConnector | undefined {
  return CHAT_CONNECTORS[provider];
}

/** 取得提供圖片、影片、語音的供應商串接；這家沒有（例如 OpenAI）時回傳 undefined。用 types 看它提供哪些類型。 */
export function getMediaConnector(provider: ProviderId): MediaConnector | undefined {
  return MEDIA_CONNECTORS[provider];
}
