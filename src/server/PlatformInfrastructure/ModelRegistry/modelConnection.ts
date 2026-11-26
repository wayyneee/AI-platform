// 模型的連線方式：檢查供應商有沒有這個類型、key 是不是同一家供應商的、Forge 位址的格式，
// 再換成呼叫供應商要用的 key 值或位址。完整的 key 只在這裡取出交給 ProviderConnectors，不放進錯誤細節。

import {
  MODEL_TYPE_PROVIDERS,
  type ApiKeySummary,
  type ModelConnectionChoice,
  type ModelType,
  type ProviderId,
  type SavedModel,
} from '../../../shared/PlatformInfrastructure/types.ts';
import type { MediaConnection } from '../ProviderConnectors/index.ts';
import { createError, defineErrorCodes } from '../SystemLog/index.ts';
import { ApiKeyErrorCodes, findApiKey, getApiKeyValue } from './apiKeyStore.ts';

const MODULE_NAME = 'PlatformInfrastructure';
const FORGE_PROVIDER: ProviderId = 'forge';
const ALLOWED_ADDRESS_PROTOCOLS = ['http:', 'https:'];

export const ModelConnectionErrorCodes = defineErrorCodes({
  MODEL_TYPE_INVALID: 'warning',
  MODEL_KEY_REQUIRED: 'warning',
  MODEL_KEY_PROVIDER_MISMATCH: 'warning',
  MODEL_KEY_MISSING: 'warning',
  MODEL_ADDRESS_INVALID: 'warning',
});

/** 換好的連線：給 ProviderConnectors 用的 key 值或位址，以及寫 log 用的 key 名稱。 */
export interface ResolvedConnection {
  type: ModelType;
  provider: ProviderId;
  connection: MediaConnection;
  /** 雲端供應商的 key 編號；Forge 為 null */
  keyId: string | null;
  /** Forge 整理過的位址；雲端供應商為 null */
  address: string | null;
  /** log 只記 key 的名稱 */
  keyName?: string;
}

// ===== 主要流程 =====

/**
 * 依使用者的選擇換成連線。
 * 這家沒有這個類型時丟出 MODEL_TYPE_INVALID；雲端供應商沒選 key 時丟出 MODEL_KEY_REQUIRED；
 * key 不存在時丟出 API_KEY_NOT_FOUND；key 是別家供應商的時丟出 MODEL_KEY_PROVIDER_MISMATCH；
 * Forge 位址不是 http(s) 網址時丟出 MODEL_ADDRESS_INVALID。
 */
export function resolveConnection(
  choice: ModelConnectionChoice,
  interfaceName: string,
): ResolvedConnection {
  checkProviderOffersType(choice.provider, choice.type, interfaceName);
  if (choice.provider === FORGE_PROVIDER) {
    const address = normalizeAddress(choice.address ?? '', interfaceName);
    return { ...pickTarget(choice), connection: { address }, keyId: null, address };
  }
  if (!choice.keyId) {
    throw createError(
      MODULE_NAME,
      interfaceName,
      ModelConnectionErrorCodes.MODEL_KEY_REQUIRED,
      `供應商「${choice.provider}」的模型要選一組 API key`,
      { provider: choice.provider },
    );
  }
  return resolveKey(choice.type, choice.provider, choice.keyId, interfaceName);
}

/**
 * 已儲存模型的連線，給測試與呼叫模型使用。
 * key 被刪除（key 欄位為空）時丟出 MODEL_KEY_MISSING，要重新選 key 才能使用（spec 規則）。
 */
export function resolveSavedModelConnection(
  model: SavedModel,
  interfaceName: string,
): ResolvedConnection {
  if (model.provider === FORGE_PROVIDER) {
    return resolveConnection({ ...pickTarget(model), address: model.address ?? '' }, interfaceName);
  }
  if (!model.keyId) {
    throw createError(
      MODULE_NAME,
      interfaceName,
      ModelConnectionErrorCodes.MODEL_KEY_MISSING,
      `模型「${model.displayName}」選用的 API key 已被刪除，要重新選 key 才能使用`,
      { modelId: model.id },
    );
  }
  return resolveKey(model.type, model.provider, model.keyId, interfaceName);
}

/**
 * 替模型換 key 時檢查：key 要存在，而且是同一家供應商的。
 * 不同供應商時丟出 MODEL_KEY_PROVIDER_MISMATCH；key 不存在時丟出 API_KEY_NOT_FOUND。
 */
export function checkKeyForProvider(
  keyId: string,
  provider: ProviderId,
  interfaceName: string,
): void {
  requireKeyOfProvider(keyId, provider, interfaceName);
}

// ===== 檢查 =====

/** spec：OpenAI、Gemini、Claude 只有 LLM；Forge 只有圖片。 */
function checkProviderOffersType(
  provider: ProviderId,
  type: ModelType,
  interfaceName: string,
): void {
  if (MODEL_TYPE_PROVIDERS[type]?.includes(provider)) return;
  throw createError(
    MODULE_NAME,
    interfaceName,
    ModelConnectionErrorCodes.MODEL_TYPE_INVALID,
    `供應商「${provider}」沒有提供「${type}」類型的模型`,
    { provider, type },
  );
}

function resolveKey(
  type: ModelType,
  provider: ProviderId,
  keyId: string,
  interfaceName: string,
): ResolvedConnection {
  const key = requireKeyOfProvider(keyId, provider, interfaceName);
  return {
    type,
    provider,
    connection: { apiKey: getApiKeyValue(keyId) },
    keyId,
    address: null,
    keyName: key.name,
  };
}

function requireKeyOfProvider(
  keyId: string,
  provider: ProviderId,
  interfaceName: string,
): ApiKeySummary {
  const key = findApiKey(keyId);
  if (!key) {
    throw createError(
      MODULE_NAME,
      interfaceName,
      ApiKeyErrorCodes.API_KEY_NOT_FOUND,
      `找不到編號為 ${keyId} 的 API key，可能已經被刪除`,
      { keyId },
    );
  }
  if (key.provider === provider) return key;
  throw createError(
    MODULE_NAME,
    interfaceName,
    ModelConnectionErrorCodes.MODEL_KEY_PROVIDER_MISMATCH,
    `模型的供應商是「${provider}」，選的 key 是「${key.provider}」的`,
    { provider, keyProvider: key.provider, keyId },
  );
}

/** 去掉前後空白和結尾的斜線；只接受 http、https 網址。 */
function normalizeAddress(address: string, interfaceName: string): string {
  const trimmed = address.trim().replace(/\/+$/, '');
  if (isHttpUrl(trimmed)) return trimmed;
  throw createError(
    MODULE_NAME,
    interfaceName,
    ModelConnectionErrorCodes.MODEL_ADDRESS_INVALID,
    'Forge 的位址要是 http:// 或 https:// 開頭的網址',
    { address: trimmed },
  );
}

// ===== 輔助 =====

function isHttpUrl(text: string): boolean {
  try {
    return ALLOWED_ADDRESS_PROTOCOLS.includes(new URL(text).protocol);
  } catch {
    return false;
  }
}

function pickTarget(source: { type: ModelType; provider: ProviderId }) {
  return { type: source.type, provider: source.provider };
}
