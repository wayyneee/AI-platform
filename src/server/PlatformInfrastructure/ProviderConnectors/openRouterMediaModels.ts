// OpenRouter 的圖片、影片、語音模型偵測：三個類型各有自己的模型清單端點，每個模型回報它接受的參數和可選值，
// 平台依這些可選值組出可調參數（spec：OpenRouter 的可選值向 API 查詢）。不自動帶入價格（spec：只有 LLM 自動帶入）。

import {
  MEDIA_PARAM_KEYS,
  type DetectedModel,
  type MediaModelType,
  type ParamDefinition,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { asArray, asRecord, asString } from './chatHelpers.ts';
import { toContentKinds } from './mediaHelpers.ts';
import {
  classifyByStatus,
  createProviderError,
  requestProviderJson,
  type ProviderCallContext,
} from './providerRequest.ts';
import { authorizationHeader } from './responsesApiFormat.ts';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const MODELS_PATHS: Record<MediaModelType, string> = {
  image: '/images/models',
  video: '/videos/models',
  audio: '/audio/speech/models',
};

/** 圖片模型回報的參數名稱 → 平台的參數 key；張數、種子只能是整數。 */
const IMAGE_PARAM_NAMES: Array<{ apiName: string; key: string; isInteger?: boolean }> = [
  { apiName: 'n', key: MEDIA_PARAM_KEYS.count, isInteger: true },
  { apiName: 'aspect_ratio', key: MEDIA_PARAM_KEYS.aspectRatio },
  { apiName: 'resolution', key: MEDIA_PARAM_KEYS.resolution },
  { apiName: 'quality', key: MEDIA_PARAM_KEYS.quality },
  { apiName: 'seed', key: MEDIA_PARAM_KEYS.seed, isInteger: true },
];

/** 圖片模型接受參考圖時，參數清單裡有這個欄位。 */
export const IMAGE_REFERENCE_FIELD = 'input_references';

type JsonObject = Record<string, unknown>;

// ===== 偵測模型 =====

/** 列出這個類型的模型。 */
export async function listOpenRouterMediaModels(
  type: MediaModelType,
  context: ProviderCallContext,
  apiKey: string,
): Promise<DetectedModel[]> {
  const body = await requestProviderJson<JsonObject>({
    ...context,
    url: `${OPENROUTER_BASE_URL}${MODELS_PATHS[type]}`,
    headers: authorizationHeader(apiKey),
    classifyError: classifyByStatus,
  });
  const models = asArray(body.data).map(asRecord);
  if (type === 'image') return models.map(toImageModel);
  if (type === 'video') return models.map(toVideoModel);
  return models.map(toSpeechModel);
}

/** 確認 key 有效、模型存在；不實際生成。 */
export async function checkOpenRouterMediaModel(
  type: MediaModelType,
  model: string,
  context: ProviderCallContext,
  apiKey: string,
): Promise<void> {
  // 模型清單不需要 key，所以另外查 key 本身：無效時回 401
  await requestProviderJson({
    ...context,
    url: `${OPENROUTER_BASE_URL}/key`,
    headers: authorizationHeader(apiKey),
    classifyError: classifyByStatus,
  });
  const models = await listOpenRouterMediaModels(type, context, apiKey);
  if (!models.some((detected) => detected.id === model)) {
    throw createProviderError(context, 'PROVIDER_MODEL_NOT_FOUND', { model });
  }
}

// ===== 各類型的模型 =====

function toImageModel(model: JsonObject): DetectedModel {
  const supported = asRecord(model.supported_parameters);
  const params: ParamDefinition[] = [];
  for (const { apiName, key, isInteger } of IMAGE_PARAM_NAMES) {
    const param = toParamDefinition(key, asRecord(supported[apiName]), isInteger);
    if (param) params.push(param);
  }
  const architecture = asRecord(model.architecture);
  return baseModel(model, 'image', params, {
    inputKinds: readKinds(architecture.input_modalities),
    outputKinds: readKinds(architecture.output_modalities),
  });
}

function toVideoModel(model: JsonObject): DetectedModel {
  const params: ParamDefinition[] = [];
  const durations = asArray(model.supported_durations).filter(isPositiveNumber);
  if (durations.length > 0) {
    // 預設用最短的秒數：一定知道送了幾秒（用量以秒計），也最便宜
    params.push(
      selectParam(MEDIA_PARAM_KEYS.duration, durations.map(String), String(Math.min(...durations))),
    );
  }
  addSelectIfAny(params, MEDIA_PARAM_KEYS.resolution, model.supported_resolutions);
  addSelectIfAny(params, MEDIA_PARAM_KEYS.aspectRatio, model.supported_aspect_ratios);
  if (typeof model.generate_audio === 'boolean') {
    params.push({
      key: MEDIA_PARAM_KEYS.generateAudio,
      kind: 'boolean',
      default: model.generate_audio,
    });
  }
  if (model.seed === true) {
    params.push({ key: MEDIA_PARAM_KEYS.seed, kind: 'number', isInteger: true });
  }
  const frames = asArray(model.supported_frame_images).map(asString);
  return baseModel(model, 'video', params, {
    inputKinds: frames.includes('first_frame') ? ['text', 'image'] : ['text'],
    outputKinds: ['video'],
  });
}

function toSpeechModel(model: JsonObject): DetectedModel {
  const speech = asArray(model.output_modalities)
    .map(asRecord)
    .find((output) => output.type === 'speech');
  const supported = asRecord(asRecord(speech).supported_parameters);
  const params: ParamDefinition[] = [];
  const voices = asArray(asRecord(supported.voice).values).map(asString).filter(Boolean);
  // 聲音大多是必填，預設帶第一個；沒有公開清單（type 為 unknown）時不列，交給供應商的預設
  if (voices.length > 0) params.push(selectParam(MEDIA_PARAM_KEYS.voice, voices, voices[0]));
  const speed = toParamDefinition(MEDIA_PARAM_KEYS.speed, asRecord(supported.speed));
  if (speed) params.push(speed);
  return baseModel(model, 'audio', params, {
    inputKinds: readKinds(model.input_modalities),
    outputKinds: ['audio'],
  });
}

// ===== 輔助 =====

function baseModel(
  model: JsonObject,
  type: MediaModelType,
  params: ParamDefinition[],
  kinds: Pick<DetectedModel, 'inputKinds' | 'outputKinds'>,
): DetectedModel {
  const id = asString(model.id);
  const detected: DetectedModel = {
    id,
    displayName: asString(model.name) || id,
    type,
    params,
    ...kinds,
  };
  const description = asString(model.description);
  if (description) detected.description = description;
  return detected;
}

/** OpenRouter 的參數描述轉成平台的參數定義：enum → 選單、range → 數字、boolean → 是／否；其他略過。 */
function toParamDefinition(
  key: string,
  descriptor: JsonObject,
  isInteger?: boolean,
): ParamDefinition | undefined {
  if (descriptor.type === 'enum') {
    const values = asArray(descriptor.values).map(String);
    return values.length > 0 ? selectParam(key, values) : undefined;
  }
  if (descriptor.type === 'range') {
    const param: ParamDefinition = { key, kind: 'number' };
    if (typeof descriptor.min === 'number') param.min = descriptor.min;
    if (typeof descriptor.max === 'number') param.max = descriptor.max;
    if (isInteger) param.isInteger = true;
    return param;
  }
  if (descriptor.type === 'boolean') return { key, kind: 'boolean' };
  return undefined;
}

function selectParam(key: string, options: string[], defaultValue?: string): ParamDefinition {
  const param: ParamDefinition = { key, kind: 'select', options };
  if (defaultValue !== undefined) param.default = defaultValue;
  return param;
}

function addSelectIfAny(params: ParamDefinition[], key: string, values: unknown): void {
  const options = asArray(values).map(asString).filter(Boolean);
  if (options.length > 0) params.push(selectParam(key, options));
}

/** 輸入輸出類型可能是文字清單，也可能是 { type } 物件清單（語音模型）。 */
function readKinds(value: unknown): DetectedModel['inputKinds'] {
  const names = asArray(value).map((item) =>
    typeof item === 'string' ? item : asString(asRecord(item).type),
  );
  return toContentKinds(names);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && value > 0;
}
