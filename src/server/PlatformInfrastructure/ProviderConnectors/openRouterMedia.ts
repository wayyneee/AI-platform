// OpenRouter 的圖片、影片、語音串接：圖片用 /images（附參考圖放 input_references），影片用 /videos 送出後查進度、
// 從 /videos/{id}/content 下載，語音用 /audio/speech。模型偵測與可調參數在 openRouterMediaModels.ts。

import {
  MEDIA_PARAM_KEYS,
  type DetectedModel,
  type MediaModelType,
  type MediaResult,
  type ParamValues,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { asArray, asRecord, asString, readStringParam } from './chatHelpers.ts';
import type { MediaConnection, MediaConnector, MediaRequest } from './connectorTypes.ts';
import {
  base64ToFile,
  downloadFile,
  imageToDataUrl,
  imageUsage,
  readBooleanParam,
  readResponseFile,
  requireApiKey,
  speechUsage,
  unknownLiveParamError,
  videoUsage,
  waitForNextPoll,
} from './mediaHelpers.ts';
import {
  checkOpenRouterMediaModel,
  listOpenRouterMediaModels,
  OPENROUTER_BASE_URL,
} from './openRouterMediaModels.ts';
import {
  classifyByStatus,
  createProviderError,
  readProviderJson,
  requestProviderJson,
  sendProviderRequest,
  type ProviderCallContext,
  type ProviderErrorCode,
} from './providerRequest.ts';
import { authorizationHeader } from './responsesApiFormat.ts';

// OpenRouter 建議每 10～30 秒查一次影片進度
const VIDEO_POLL_INTERVAL_MS = 10_000;
const IMAGE_MIME_TYPE = 'image/png';
const VIDEO_MIME_TYPE = 'video/mp4';
const SPEECH_FORMAT = 'mp3';
const SPEECH_MIME_TYPE = 'audio/mpeg';
const VIDEO_FAILED_STATUSES = ['failed', 'cancelled', 'expired'];

type JsonObject = Record<string, unknown>;

export const openRouterMediaConnector: MediaConnector = {
  provider: 'openrouter',
  types: ['image', 'video', 'audio'],
  listMediaModels,
  checkMediaModel,
  listParamOptions,
  generateMedia,
};

// ===== 偵測、確認、即時選項 =====

function listMediaModels(
  type: MediaModelType,
  connection: MediaConnection,
  signal?: AbortSignal,
): Promise<DetectedModel[]> {
  const context = callContext('listMediaModels', connection, signal);
  return listOpenRouterMediaModels(type, context, requireApiKey(connection, context));
}

function checkMediaModel(
  type: MediaModelType,
  model: string,
  connection: MediaConnection,
  signal?: AbortSignal,
): Promise<void> {
  const context = callContext('checkMediaModel', connection, signal);
  return checkOpenRouterMediaModel(type, model, context, requireApiKey(connection, context));
}

/** OpenRouter 的可選值在偵測模型時就查好了，沒有要另外即時查詢的參數。 */
async function listParamOptions(
  _type: MediaModelType,
  _model: string,
  paramKey: string,
  connection: MediaConnection,
  signal?: AbortSignal,
): Promise<string[]> {
  throw unknownLiveParamError(callContext('listParamOptions', connection, signal), paramKey);
}

// ===== 生成 =====

async function generateMedia(request: MediaRequest): Promise<MediaResult> {
  const context = callContext('generateMedia', request.connection, request.signal);
  const apiKey = requireApiKey(request.connection, context);
  if (request.type === 'image') return generateImages(request, context, apiKey);
  if (request.type === 'video') return generateVideo(request, context, apiKey);
  return generateSpeech(request, context, apiKey);
}

/** 圖片：同步回傳（沒指定 response_format 時是 base64）。 */
async function generateImages(
  request: MediaRequest,
  context: ProviderCallContext,
  apiKey: string,
): Promise<MediaResult> {
  const references = request.input.referenceImages ?? [];
  const body = await postJson(context, apiKey, '/images', {
    model: request.model,
    prompt: request.input.prompt,
    n: readIntegerParam(request.params, MEDIA_PARAM_KEYS.count),
    aspect_ratio: readStringParam(request.params, MEDIA_PARAM_KEYS.aspectRatio),
    resolution: readStringParam(request.params, MEDIA_PARAM_KEYS.resolution),
    quality: readStringParam(request.params, MEDIA_PARAM_KEYS.quality),
    seed: readIntegerParam(request.params, MEDIA_PARAM_KEYS.seed),
    input_references: references.length > 0 ? references.map(toImageReference) : undefined,
  });
  const files = asArray(body.data)
    .map(asRecord)
    .map((item) =>
      base64ToFile(asString(item.b64_json), asString(item.media_type) || IMAGE_MIME_TYPE),
    );
  if (files.length === 0) throw createProviderError(context, 'PROVIDER_RESPONSE_INVALID', { body });
  return { files, usage: imageUsage(files.length) };
}

/** 影片：送出後每隔一段時間查進度，完成後下載第一個檔案。 */
async function generateVideo(
  request: MediaRequest,
  context: ProviderCallContext,
  apiKey: string,
): Promise<MediaResult> {
  const { firstFrame } = request.input;
  const duration = readIntegerParam(request.params, MEDIA_PARAM_KEYS.duration);
  const submitted = await postJson(context, apiKey, '/videos', {
    model: request.model,
    prompt: request.input.prompt,
    duration,
    resolution: readStringParam(request.params, MEDIA_PARAM_KEYS.resolution),
    aspect_ratio: readStringParam(request.params, MEDIA_PARAM_KEYS.aspectRatio),
    generate_audio: readBooleanParam(request.params, MEDIA_PARAM_KEYS.generateAudio),
    seed: readIntegerParam(request.params, MEDIA_PARAM_KEYS.seed),
    frame_images: firstFrame
      ? [{ ...toImageReference(firstFrame), frame_type: 'first_frame' }]
      : undefined,
  });
  const jobId = asString(submitted.id);
  if (!jobId) throw createProviderError(context, 'PROVIDER_RESPONSE_INVALID', { body: submitted });
  // 只用任務編號自己組網址，不照著回應裡的網址去連
  const jobPath = `/videos/${encodeURIComponent(jobId)}`;
  await waitForVideo(request, context, apiKey, jobPath);
  const file = await downloadFile(
    `${OPENROUTER_BASE_URL}${jobPath}/content?index=0`,
    context,
    { headers: authorizationHeader(apiKey), classifyError: classifyByStatus },
    VIDEO_MIME_TYPE,
  );
  // 查進度的回應沒有影片長度，用送出的秒數計算用量（偵測時已經給秒數預設值）
  return { files: [file], usage: videoUsage(duration ?? 0) };
}

/** 查進度直到完成；失敗、被取消、過期時丟出錯誤。 */
async function waitForVideo(
  request: MediaRequest,
  context: ProviderCallContext,
  apiKey: string,
  jobPath: string,
): Promise<void> {
  for (;;) {
    const job = await getJson(context, apiKey, jobPath);
    const status = asString(job.status);
    if (status === 'completed') return;
    if (VIDEO_FAILED_STATUSES.includes(status)) {
      throw createProviderError(context, videoFailureCode(job), { body: job });
    }
    if (status === 'pending') request.onProgress?.({ status: 'queued' });
    if (status === 'in_progress') {
      const percent = typeof job.progress === 'number' ? job.progress : undefined;
      request.onProgress?.({ status: 'running', percent });
    }
    await waitForNextPoll(VIDEO_POLL_INTERVAL_MS, context);
  }
}

/** 影片任務失敗：內容審查擋下為被拒絕，請求內容有誤為不接受，其他都算供應商的錯誤。 */
function videoFailureCode(job: JsonObject): ProviderErrorCode {
  const errorType = asString(asRecord(asRecord(job.error).metadata).error_type);
  if (errorType === 'content_policy_violation') return 'PROVIDER_REQUEST_REFUSED';
  if (errorType === 'invalid_request') return 'PROVIDER_BAD_REQUEST';
  return 'PROVIDER_SERVER_ERROR';
}

/** 語音：回應內容就是音檔；固定要求 mp3（預設的 pcm 沒有檔頭，一般播放器打不開）。 */
async function generateSpeech(
  request: MediaRequest,
  context: ProviderCallContext,
  apiKey: string,
): Promise<MediaResult> {
  const text = request.input.prompt;
  const response = await sendProviderRequest({
    ...context,
    url: `${OPENROUTER_BASE_URL}/audio/speech`,
    headers: authorizationHeader(apiKey),
    body: {
      model: request.model,
      input: text,
      voice: readStringParam(request.params, MEDIA_PARAM_KEYS.voice),
      speed: readNumber(request.params, MEDIA_PARAM_KEYS.speed),
      response_format: SPEECH_FORMAT,
    },
    classifyError: classifyByStatus,
  });
  // OpenRouter 可能在 HTTP 200 的 JSON 內容裡放錯誤
  if (response.headers.get('content-type')?.includes('application/json')) {
    throwIfBodyError(await readProviderJson<JsonObject>(response, context), context);
    throw createProviderError(context, 'PROVIDER_RESPONSE_INVALID', { reason: '沒有收到音檔' });
  }
  const file = await readResponseFile(response, context, SPEECH_MIME_TYPE);
  return { files: [file], usage: speechUsage(text) };
}

// ===== 輔助 =====

function callContext(
  interfaceName: string,
  connection: MediaConnection,
  signal?: AbortSignal,
): ProviderCallContext {
  return { provider: 'openrouter', interfaceName, apiKey: connection.apiKey, signal };
}

function toImageReference(image: { mimeType: string; data: string }): JsonObject {
  return { type: 'image_url', image_url: { url: imageToDataUrl(image) } };
}

/** 讀整數參數；選單送來的是文字（例如秒數 "8"），轉回數字。 */
function readIntegerParam(params: ParamValues, key: string): number | undefined {
  const value = readNumber(params, key);
  return value === undefined ? undefined : Math.trunc(value);
}

function readNumber(params: ParamValues, key: string): number | undefined {
  const value = params[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/** HTTP 200 的內容裡有 error 時，依裡面的狀態碼轉成錯誤。 */
function throwIfBodyError(body: JsonObject, context: ProviderCallContext): void {
  if (!body.error) return;
  const error = asRecord(body.error);
  const status = typeof error.code === 'number' ? error.code : 500;
  throw createProviderError(context, classifyByStatus(status), { status, body });
}

/** 查影片進度；失敗的任務本來就帶 error 欄位，交給 waitForVideo 判斷，這裡不當成請求錯誤。 */
function getJson(context: ProviderCallContext, apiKey: string, path: string): Promise<JsonObject> {
  return requestProviderJson<JsonObject>({
    ...context,
    url: `${OPENROUTER_BASE_URL}${path}`,
    headers: authorizationHeader(apiKey),
    classifyError: classifyByStatus,
  });
}

async function postJson(
  context: ProviderCallContext,
  apiKey: string,
  path: string,
  requestBody: JsonObject,
): Promise<JsonObject> {
  const body = await requestProviderJson<JsonObject>({
    ...context,
    url: `${OPENROUTER_BASE_URL}${path}`,
    headers: authorizationHeader(apiKey),
    body: requestBody,
    classifyError: classifyByStatus,
  });
  throwIfBodyError(body, context);
  return body;
}
