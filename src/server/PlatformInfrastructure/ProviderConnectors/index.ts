// ProviderConnectors 的唯一入口：依供應商取得它的串接（偵測模型、送出對話、串流對話）。只給 ModelRegistry、ModelInvocation 使用。

import type { ProviderId } from '../../../shared/PlatformInfrastructure/types.ts';
import { claudeConnector } from './claude.ts';
import type { ProviderConnector } from './connectorTypes.ts';
import { geminiConnector } from './gemini.ts';
import { grokConnector } from './grok.ts';
import { openAiConnector } from './openAi.ts';
import { openRouterConnector } from './openRouter.ts';

export type { ChatRequest, ProviderConnector } from './connectorTypes.ts';
export { ProviderErrorCodes } from './providerRequest.ts';
export type { ProviderErrorCode } from './providerRequest.ts';

// Forge 只有圖片，在 4b 段加上
const CHAT_CONNECTORS: Partial<Record<ProviderId, ProviderConnector>> = {
  openai: openAiConnector,
  gemini: geminiConnector,
  claude: claudeConnector,
  grok: grokConnector,
  openrouter: openRouterConnector,
};

/** 取得提供 LLM 的供應商串接；這家沒有 LLM（例如 Forge）時回傳 undefined。 */
export function getChatConnector(provider: ProviderId): ProviderConnector | undefined {
  return CHAT_CONNECTORS[provider];
}
