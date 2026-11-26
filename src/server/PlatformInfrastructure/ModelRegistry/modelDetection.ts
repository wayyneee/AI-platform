// 向供應商偵測模型、測試模型、把測試成功的模型存起來、查詢模型的可調參數（含即時選項）。
// 偵測結果和測試成功的紀錄只放在記憶體：儲存時以後端記下的偵測資料為準（能力以供應商回傳的為準），
// 也確保「測試成功後才能儲存」（spec 規則）。

import {
  LLM_PARAM_KEYS,
  type DetectedModel,
  type LlmUsage,
  type MediaModelType,
  type ModelConnectionChoice,
  type ModelTestInput,
  type NewModel,
  type ParamDefinition,
  type ProviderId,
  type SavedModel,
} from '../../../shared/PlatformInfrastructure/types.ts';
import {
  getChatConnector,
  getMediaConnector,
  type MediaConnector,
  type ProviderConnector,
} from '../ProviderConnectors/index.ts';
import { createError, defineErrorCodes } from '../SystemLog/index.ts';
import {
  ModelConnectionErrorCodes,
  resolveConnection,
  resolveSavedModelConnection,
  type ResolvedConnection,
} from './modelConnection.ts';
import { insertModel, requireModel } from './modelStore.ts';

const MODULE_NAME = 'PlatformInfrastructure';
// spec：測試不花錢。LLM 送一則「Hi」（回覆上限 16 token），語音送「測試」兩個字
const LLM_TEST_PROMPT = 'Hi';
const LLM_TEST_MAX_OUTPUT_TOKENS = 16;
const AUDIO_TEST_TEXT = '測試';

export const ModelDetectionErrorCodes = defineErrorCodes({
  MODEL_NOT_TESTED: 'warning',
});

/** 偵測的結果：模型清單，以及寫 log 用的連線資訊。 */
export interface DetectionResult {
  models: DetectedModel[];
  connection: ResolvedConnection;
}

/** 測試成功的結果：LLM 附上這次測試的用量（寫 log 用）。 */
export interface TestResult {
  connection: ResolvedConnection;
  usage?: LlmUsage;
}

// 連線方式（類型、供應商、key 或位址）→ 最近一次偵測到的模型
const detectedByConnection = new Map<string, DetectedModel[]>();
// 連線方式加模型名稱 → 測試成功時的偵測資料；儲存後移除
const testedModels = new Map<string, DetectedModel>();

// ===== 偵測 =====

/** 用選好的 key 或位址偵測這個類型可用的模型（含能力、自動帶入的價格、可調參數）。失敗時丟出連線或供應商的錯誤。 */
export async function detectModels(choice: ModelConnectionChoice): Promise<DetectionResult> {
  const interfaceName = 'detectModels';
  const connection = resolveConnection(choice, interfaceName);
  const models =
    connection.type === 'llm'
      ? await requireChatConnector(connection, interfaceName).listChatModels(
          connection.connection.apiKey ?? '',
        )
      : await requireMediaConnector(connection, interfaceName).listMediaModels(
          connection.type,
          connection.connection,
        );
  detectedByConnection.set(connectionKey(connection), models);
  return { models, connection };
}

// ===== 測試 =====

/**
 * 用這組設定測試模型（spec：測試不花錢）：LLM 送「Hi」、語音念「測試」，圖片、影片只確認 key 有效、模型存在。
 * 測試成功後才能用同樣的設定儲存。失敗時丟出連線或供應商的錯誤（例如 PROVIDER_KEY_INVALID）。
 */
export async function testModel(input: ModelTestInput): Promise<TestResult> {
  const interfaceName = 'testModel';
  const connection = resolveConnection(input, interfaceName);
  const usage = await runTest(connection, input.modelId, interfaceName);
  rememberTestedModel(connection, input.modelId);
  return { connection, usage };
}

// ===== 新增 =====

/**
 * 儲存測試成功的模型；能力、可調參數以測試時後端偵測到的資料為準。
 * 沒有用同樣的設定測試成功時丟出 MODEL_NOT_TESTED（平台重新啟動後要重新測試）。
 */
export function addModel(input: NewModel): SavedModel {
  const interfaceName = 'addModel';
  const connection = resolveConnection(input, interfaceName);
  const testKey = testedModelKey(connection, input.modelId);
  const detected = testedModels.get(testKey);
  if (!detected) {
    throw createError(
      MODULE_NAME,
      interfaceName,
      ModelDetectionErrorCodes.MODEL_NOT_TESTED,
      `模型「${input.modelId}」還沒有用這組設定測試成功，或平台重新啟動過`,
      { provider: input.provider, type: input.type, modelId: input.modelId },
    );
  }
  const model = insertModel(
    { detected, connection, displayName: input.displayName, price: input.price },
    interfaceName,
  );
  testedModels.delete(testKey);
  return model;
}

// ===== 可調參數 =====

/**
 * 查詢模型的可調參數；有即時選項的參數（Grok 的聲音、Forge 的模型檔、LoRA、取樣器）向供應商查詢後填入。
 * 找不到模型時丟出 MODEL_NOT_FOUND；要即時查詢但 key 已被刪除時丟出 MODEL_KEY_MISSING；查詢失敗時丟出供應商的錯誤。
 */
export async function getModelParams(id: string): Promise<ParamDefinition[]> {
  const interfaceName = 'getModelParams';
  const model = requireModel(id, interfaceName);
  if (!hasLiveParams(model.params) || model.type === 'llm') return model.params;

  const connection = resolveSavedModelConnection(model, interfaceName);
  const connector = requireMediaConnector(connection, interfaceName);
  return Promise.all(
    model.params.map((param) =>
      fillLiveOptions(param, model.type as MediaModelType, model.modelId, connector, connection),
    ),
  );
}

/** 參數中有沒有要即時查詢選項的（只有這種模型查參數時才會連到供應商）。 */
export function hasLiveParams(params: ParamDefinition[]): boolean {
  return params.some((param) => 'hasLiveOptions' in param && param.hasLiveOptions);
}

// ===== 測試的做法 =====

async function runTest(
  connection: ResolvedConnection,
  modelId: string,
  interfaceName: string,
): Promise<LlmUsage | undefined> {
  if (connection.type === 'llm') {
    const result = await requireChatConnector(connection, interfaceName).sendChat({
      model: modelId,
      apiKey: connection.connection.apiKey ?? '',
      input: { messages: [{ role: 'user', text: LLM_TEST_PROMPT }] },
      params: { [LLM_PARAM_KEYS.maxOutputTokens]: LLM_TEST_MAX_OUTPUT_TOKENS },
    });
    return result.usage;
  }
  const connector = requireMediaConnector(connection, interfaceName);
  if (connection.type === 'audio') {
    await connector.generateMedia({
      type: 'audio',
      model: modelId,
      connection: connection.connection,
      input: { prompt: AUDIO_TEST_TEXT },
      params: {},
    });
    return undefined;
  }
  await connector.checkMediaModel(connection.type, modelId, connection.connection);
  return undefined;
}

/** 記下測試成功的模型；偵測清單裡沒有它時（例如測試已儲存的模型）不用記。 */
function rememberTestedModel(connection: ResolvedConnection, modelId: string): void {
  const detected = detectedByConnection
    .get(connectionKey(connection))
    ?.find((model) => model.id === modelId);
  if (detected) testedModels.set(testedModelKey(connection, modelId), detected);
}

async function fillLiveOptions(
  param: ParamDefinition,
  type: MediaModelType,
  modelId: string,
  connector: MediaConnector,
  connection: ResolvedConnection,
): Promise<ParamDefinition> {
  if (!('hasLiveOptions' in param) || !param.hasLiveOptions) return param;
  const options = await connector.listParamOptions(type, modelId, param.key, connection.connection);
  return { ...param, options };
}

// ===== 輔助 =====

/** 連線方式的代號：同一個類型、供應商、key 或位址算同一組。 */
function connectionKey(connection: ResolvedConnection): string {
  return [connection.type, connection.provider, connection.keyId ?? connection.address].join('|');
}

function testedModelKey(connection: ResolvedConnection, modelId: string): string {
  return `${connectionKey(connection)}|${modelId}`;
}

function requireChatConnector(
  connection: ResolvedConnection,
  interfaceName: string,
): ProviderConnector {
  const connector = getChatConnector(connection.provider);
  if (connector) return connector;
  throw missingConnectorError(connection.provider, connection.type, interfaceName);
}

function requireMediaConnector(
  connection: ResolvedConnection,
  interfaceName: string,
): MediaConnector {
  const connector = getMediaConnector(connection.provider);
  if (connector?.types.includes(connection.type as MediaModelType)) return connector;
  throw missingConnectorError(connection.provider, connection.type, interfaceName);
}

/** 平台的類型對照表和串接不一致時才會發生；當成這家沒有這個類型回報。 */
function missingConnectorError(provider: ProviderId, type: string, interfaceName: string) {
  return createError(
    MODULE_NAME,
    interfaceName,
    ModelConnectionErrorCodes.MODEL_TYPE_INVALID,
    `供應商「${provider}」沒有「${type}」類型的串接`,
    { provider, type },
  );
}
