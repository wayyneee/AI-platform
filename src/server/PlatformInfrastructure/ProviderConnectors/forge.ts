// 本機 Forge（Stable Diffusion WebUI Forge，啟動時要加 --api）的串接：只有圖片。
// 模型檔就是「模型」（偵測時列出 /sdapi/v1/sd-models），文字生圖用 txt2img，附參考圖時用 img2img 改圖；
// 生成期間另外查 /sdapi/v1/progress 回報進度。LoRA、取樣器、排程器的選項即時查詢，LoRA 寫進提示詞生效。

import {
  MEDIA_PARAM_KEYS,
  type DetectedModel,
  type MediaFile,
  type MediaModelType,
  type MediaResult,
  type ParamDefinition,
  type WeightedChoice,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { isPlatformError } from '../SystemLog/index.ts';
import { asArray, asRecord, asString, readNumberParam, readStringParam } from './chatHelpers.ts';
import type { MediaConnection, MediaConnector, MediaRequest } from './connectorTypes.ts';
import {
  base64ToFile,
  imageUsage,
  readWeightedListParam,
  unknownLiveParamError,
  unsupportedTypeError,
  waitForNextPoll,
} from './mediaHelpers.ts';
import {
  classifyByStatus,
  createProviderError,
  requestProviderJson,
  type ProviderCallContext,
  type ProviderErrorCode,
} from './providerRequest.ts';

const PROGRESS_POLL_INTERVAL_MS = 1000;
const PERCENT = 100;
const DEFAULT_IMAGE_COUNT = 1;
const DEFAULT_MIME_TYPE = 'image/png';

/** 即時選項：參數 key → Forge 的清單端點。 */
const LIVE_OPTION_PATHS: Record<string, string> = {
  [MEDIA_PARAM_KEYS.sampler]: '/sdapi/v1/samplers',
  [MEDIA_PARAM_KEYS.scheduler]: '/sdapi/v1/schedulers',
  [MEDIA_PARAM_KEYS.loras]: '/sdapi/v1/loras',
};

type JsonObject = Record<string, unknown>;

export const forgeConnector: MediaConnector = {
  provider: 'forge',
  types: ['image'],
  listMediaModels,
  checkMediaModel,
  listParamOptions,
  generateMedia,
};

// ===== 偵測模型 =====

async function listMediaModels(
  type: MediaModelType,
  connection: MediaConnection,
  signal?: AbortSignal,
): Promise<DetectedModel[]> {
  const context = callContext('listMediaModels', signal);
  if (type !== 'image') throw unsupportedTypeError(context, type);
  const checkpoints = await forgeGet<unknown[]>(context, connection, '/sdapi/v1/sd-models');
  return asArray(checkpoints)
    .map((checkpoint) => asString(asRecord(checkpoint).model_name))
    .filter(Boolean)
    .map(toDetectedModel);
}

function toDetectedModel(checkpoint: string): DetectedModel {
  return {
    id: checkpoint,
    displayName: checkpoint,
    type: 'image',
    params: forgeParams(),
    inputKinds: ['text', 'image'],
    outputKinds: ['image'],
  };
}

/** Forge 的可調參數：範圍依 Forge 畫面上的設定；取樣器、排程器、LoRA 即時查詢。 */
function forgeParams(): ParamDefinition[] {
  return [
    {
      key: MEDIA_PARAM_KEYS.count,
      kind: 'number',
      min: 1,
      max: 8,
      isInteger: true,
      default: DEFAULT_IMAGE_COUNT,
    },
    { key: MEDIA_PARAM_KEYS.width, kind: 'number', min: 64, max: 2048, isInteger: true },
    { key: MEDIA_PARAM_KEYS.height, kind: 'number', min: 64, max: 2048, isInteger: true },
    { key: MEDIA_PARAM_KEYS.steps, kind: 'number', min: 1, max: 150, isInteger: true, default: 20 },
    { key: MEDIA_PARAM_KEYS.cfgScale, kind: 'number', min: 1, max: 30, default: 7 },
    { key: MEDIA_PARAM_KEYS.sampler, kind: 'select', options: [], hasLiveOptions: true },
    { key: MEDIA_PARAM_KEYS.scheduler, kind: 'select', options: [], hasLiveOptions: true },
    // -1 代表每次隨機
    { key: MEDIA_PARAM_KEYS.seed, kind: 'number', min: -1, isInteger: true, default: -1 },
    // 只有附參考圖（改圖）時使用
    { key: MEDIA_PARAM_KEYS.denoisingStrength, kind: 'number', min: 0, max: 1, default: 0.75 },
    {
      key: MEDIA_PARAM_KEYS.loras,
      kind: 'weightedList',
      options: [],
      weight: { min: -2, max: 2, default: 1 },
      hasLiveOptions: true,
    },
  ];
}

// ===== 確認模型、即時選項 =====

async function checkMediaModel(
  type: MediaModelType,
  model: string,
  connection: MediaConnection,
  signal?: AbortSignal,
): Promise<void> {
  const context = callContext('checkMediaModel', signal);
  const models = await listMediaModels(type, connection, signal);
  if (!models.some((detected) => detected.id === model)) {
    throw createProviderError(context, 'PROVIDER_MODEL_NOT_FOUND', { model });
  }
}

/** 取樣器、排程器、LoRA 都用清單裡的 name（LoRA 的 name 是檔名，寫進提示詞時用它）。 */
async function listParamOptions(
  _type: MediaModelType,
  _model: string,
  paramKey: string,
  connection: MediaConnection,
  signal?: AbortSignal,
): Promise<string[]> {
  const context = callContext('listParamOptions', signal);
  const path = LIVE_OPTION_PATHS[paramKey];
  if (!path) throw unknownLiveParamError(context, paramKey);
  const items = await forgeGet<unknown[]>(context, connection, path);
  return asArray(items)
    .map((item) => asString(asRecord(item).name))
    .filter(Boolean);
}

// ===== 生成 =====

/** 送出 txt2img 或 img2img；等待期間查進度，中止時請 Forge 停下目前的生成。 */
async function generateMedia(request: MediaRequest): Promise<MediaResult> {
  const context = callContext('generateMedia', request.signal);
  if (request.type !== 'image') throw unsupportedTypeError(context, request.type);
  const count = readNumberParam(request.params, MEDIA_PARAM_KEYS.count) ?? DEFAULT_IMAGE_COUNT;
  const referenceImage = request.input.referenceImages?.[0];
  const path = referenceImage ? '/sdapi/v1/img2img' : '/sdapi/v1/txt2img';
  const body = buildGenerationBody(request);
  // 改圖只用第一張參考圖：Forge 的 img2img 是以一張圖為底重畫
  if (referenceImage) body.init_images = [referenceImage.data];

  const stopProgress = startProgressPolling(request, context);
  const stopInterrupt = interruptWhenAborted(request);
  try {
    const response = await forgePost<JsonObject>(context, request.connection, path, body);
    const files = asArray(response.images)
      .map(asString)
      .filter(Boolean)
      .slice(0, count)
      .map(toImageFile);
    if (files.length === 0)
      throw createProviderError(context, 'PROVIDER_RESPONSE_INVALID', { reason: '沒有回傳圖片' });
    return { files, usage: imageUsage(files.length) };
  } finally {
    stopProgress();
    stopInterrupt();
  }
}

function buildGenerationBody(request: MediaRequest): JsonObject {
  const { params } = request;
  const loras = readWeightedListParam(params, MEDIA_PARAM_KEYS.loras);
  const body: JsonObject = {
    prompt: withLoraTags(request.input.prompt, loras),
    negative_prompt: request.input.negativePrompt,
    batch_size: readNumberParam(params, MEDIA_PARAM_KEYS.count),
    width: readNumberParam(params, MEDIA_PARAM_KEYS.width),
    height: readNumberParam(params, MEDIA_PARAM_KEYS.height),
    steps: readNumberParam(params, MEDIA_PARAM_KEYS.steps),
    cfg_scale: readNumberParam(params, MEDIA_PARAM_KEYS.cfgScale),
    sampler_name: readStringParam(params, MEDIA_PARAM_KEYS.sampler),
    scheduler: readStringParam(params, MEDIA_PARAM_KEYS.scheduler),
    seed: readNumberParam(params, MEDIA_PARAM_KEYS.seed),
    // 這次請求用這個模型檔；不回傳多張合成的格狀總覽圖，只要每一張
    override_settings: { sd_model_checkpoint: request.model, return_grid: false },
    send_images: true,
    save_images: false,
  };
  if (request.input.referenceImages?.length) {
    body.denoising_strength = readNumberParam(params, MEDIA_PARAM_KEYS.denoisingStrength);
  }
  return body;
}

/** LoRA 在 Forge 是寫進提示詞生效：<lora:名稱:權重>。 */
function withLoraTags(prompt: string, loras: WeightedChoice[]): string {
  if (loras.length === 0) return prompt;
  const tags = loras.map((lora) => `<lora:${lora.name}:${lora.weight}>`);
  return [prompt, ...tags].join(' ');
}

function toImageFile(base64: string): MediaFile {
  return base64ToFile(base64, DEFAULT_MIME_TYPE);
}

// ===== 進度與中止 =====

/** 每隔一段時間查進度，直到回傳的函式被呼叫；查進度失敗不影響生成本身。 */
function startProgressPolling(request: MediaRequest, context: ProviderCallContext): () => void {
  const stopController = new AbortController();
  const pollContext = { ...context, signal: stopController.signal };
  void (async () => {
    while (!stopController.signal.aborted) {
      await waitForNextPoll(PROGRESS_POLL_INTERVAL_MS, pollContext);
      const progress = await forgeGet<JsonObject>(
        pollContext,
        request.connection,
        '/sdapi/v1/progress?skip_current_image=true',
      );
      if (stopController.signal.aborted) return;
      reportProgress(request, progress);
    }
  })().catch(() => undefined);
  return () => stopController.abort();
}

/** Forge 還沒開始這件工作（job_count 為 0）時算排隊中，否則回報百分比。 */
function reportProgress(request: MediaRequest, progress: JsonObject): void {
  const jobCount = asRecord(progress.state).job_count;
  if (jobCount === 0) {
    request.onProgress?.({ status: 'queued' });
    return;
  }
  const fraction = typeof progress.progress === 'number' ? progress.progress : 0;
  request.onProgress?.({ status: 'running', percent: Math.round(fraction * PERCENT) });
}

/** 呼叫端中止時，除了斷開請求，也請 Forge 停下正在跑的生成（不然 Forge 會繼續畫完）。 */
function interruptWhenAborted(request: MediaRequest): () => void {
  const { signal } = request;
  if (!signal) return () => undefined;
  const onAbort = (): void => {
    const context = callContext('generateMedia');
    forgePost(context, request.connection, '/sdapi/v1/interrupt', {}).catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

// ===== 送出請求 =====

function forgeGet<Result>(
  context: ProviderCallContext,
  connection: MediaConnection,
  path: string,
): Promise<Result> {
  return forgeRequest<Result>(context, connection, path);
}

function forgePost<Result>(
  context: ProviderCallContext,
  connection: MediaConnection,
  path: string,
  body: JsonObject,
): Promise<Result> {
  return forgeRequest<Result>(context, connection, path, body);
}

/** 對 Forge 發請求；連不上或沒有 API（沒加 --api）時改成提示啟動 Forge 的錯誤。 */
async function forgeRequest<Result>(
  context: ProviderCallContext,
  connection: MediaConnection,
  path: string,
  body?: JsonObject,
): Promise<Result> {
  const address = requireAddress(connection, context);
  try {
    return await requestProviderJson<Result>({
      ...context,
      url: `${address}${path}`,
      body,
      classifyError: classifyForgeError,
    });
  } catch (error) {
    if (isPlatformError(error) && error.code === 'PROVIDER_UNREACHABLE') {
      throw createProviderError(context, 'PROVIDER_FORGE_NOT_RUNNING', {
        address,
        cause: error.details,
      });
    }
    throw error;
  }
}

/** Forge 的 API 路徑都固定存在，回 404 代表啟動時沒有加 --api。 */
function classifyForgeError(status: number): ProviderErrorCode {
  if (status === 404) return 'PROVIDER_FORGE_NOT_RUNNING';
  return classifyByStatus(status);
}

/** 取出 Forge 位址，去掉結尾的斜線；沒有位址時回報錯誤。 */
function requireAddress(connection: MediaConnection, context: ProviderCallContext): string {
  const address = connection.address?.trim().replace(/\/+$/, '');
  if (address) return address;
  throw createProviderError(context, 'PROVIDER_BAD_REQUEST', { reason: '沒有提供 Forge 位址' });
}

function callContext(interfaceName: string, signal?: AbortSignal): ProviderCallContext {
  return { provider: 'forge', interfaceName, signal };
}
