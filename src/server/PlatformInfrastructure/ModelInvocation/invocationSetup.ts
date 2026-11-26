// 呼叫前的準備：找到已儲存的模型、確認類型可以用這種方式呼叫、換成連線（key 或 Forge 位址）、檢查參數。
// 本模組不依能力擋下呼叫（spec 重要決定），所以這裡不看模型能力。

import type {
  ParamValues,
  ProviderId,
  SavedModel,
} from '../../../shared/PlatformInfrastructure/types.ts';
import {
  getModelParams,
  requireModel,
  resolveSavedModelConnection,
  type ResolvedConnection,
} from '../ModelRegistry/index.ts';
import {
  getChatConnector,
  getMediaConnector,
  type MediaConnector,
  type ProviderConnector,
} from '../ProviderConnectors/index.ts';
import { createError, defineErrorCodes } from '../SystemLog/index.ts';
import { validateParams } from './paramValidation.ts';

const MODULE_NAME = 'PlatformInfrastructure';

export const InvocationSetupErrorCodes = defineErrorCodes({
  INVOCATION_MODEL_TYPE_MISMATCH: 'warning',
});

/** 呼叫方式：LLM 用一般呼叫或串流，圖片、影片、語音一律用任務（spec 規則）。 */
export type InvocationKind = 'chat' | 'media';

/** 準備好的呼叫：模型、連線、檢查過的參數。 */
export interface PreparedInvocation {
  model: SavedModel;
  connection: ResolvedConnection;
  params: ParamValues;
}

// ===== 主要流程 =====

/**
 * 準備一次呼叫。找不到模型時丟出 MODEL_NOT_FOUND；類型不能用這種方式呼叫時丟出 INVOCATION_MODEL_TYPE_MISMATCH；
 * key 已被刪除時丟出 MODEL_KEY_MISSING；參數不對時丟出 INVOCATION_PARAM_INVALID；查即時選項失敗時丟出供應商的錯誤。
 */
export async function prepareInvocation(
  modelId: string,
  values: ParamValues,
  kind: InvocationKind,
  interfaceName: string,
): Promise<PreparedInvocation> {
  const model = requireModel(modelId, interfaceName);
  checkModelKind(model, kind, interfaceName);
  const connection = resolveSavedModelConnection(model, interfaceName);
  // 有即時選項的參數（Grok 的聲音、Forge 的 LoRA 等）要查到目前的清單，才能檢查選項在不在清單中
  const definitions = await getModelParams(model.id);
  const params = validateParams(definitions, values, interfaceName);
  return { model, connection, params };
}

// ===== 取得串接 =====

/** 取得 LLM 的串接；平台的類型對照表和串接不一致時才會找不到。 */
export function requireChatConnector(
  prepared: PreparedInvocation,
  interfaceName: string,
): ProviderConnector {
  const connector = getChatConnector(prepared.model.provider);
  if (connector) return connector;
  throw missingConnectorError(prepared.model.provider, interfaceName);
}

/** 取得圖片、影片、語音的串接。 */
export function requireMediaConnector(
  prepared: PreparedInvocation,
  interfaceName: string,
): MediaConnector {
  const connector = getMediaConnector(prepared.model.provider);
  if (connector) return connector;
  throw missingConnectorError(prepared.model.provider, interfaceName);
}

// ===== 輔助 =====

function checkModelKind(model: SavedModel, kind: InvocationKind, interfaceName: string): void {
  const isChatModel = model.type === 'llm';
  if (isChatModel === (kind === 'chat')) return;
  const expected = kind === 'chat' ? 'LLM' : '圖片、影片、語音';
  const howToCall = isChatModel ? 'invokeModel 或 streamModel' : 'submitTask';
  throw createError(
    MODULE_NAME,
    interfaceName,
    InvocationSetupErrorCodes.INVOCATION_MODEL_TYPE_MISMATCH,
    `${interfaceName} 只能呼叫${expected}模型，模型「${model.displayName}」要用 ${howToCall}`,
    { modelId: model.id, type: model.type },
  );
}

function missingConnectorError(provider: ProviderId, interfaceName: string) {
  return createError(
    MODULE_NAME,
    interfaceName,
    InvocationSetupErrorCodes.INVOCATION_MODEL_TYPE_MISMATCH,
    `供應商「${provider}」沒有這種模型的串接`,
    { provider },
  );
}
