// Grok（xAI）的圖片、影片、語音串接：圖片用 /images/generations（附參考圖時用 /images/edits），
// 影片用 /videos/generations 送出後查進度、下載，語音用 /tts。模型偵測結果與可調參數在 grokMediaModels.ts。

import {
  MEDIA_PARAM_KEYS,
  type DetectedModel,
  type MediaFile,
  type MediaModelType,
  type MediaResult,
} from '../../../shared/PlatformInfrastructure/types.ts';
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  readNumberParam,
  readStringParam,
} from './chatHelpers.ts';
import type { MediaConnection, MediaConnector, MediaRequest } from './connectorTypes.ts';
import { GROK_DEFAULT_VOICE, grokSpeechModel, toGrokMediaModel } from './grokMediaModels.ts';
import {
  base64ToFile,
  downloadFile,
  imageToDataUrl,
  imageUsage,
  readResponseFile,
  requireApiKey,
  speechUsage,
  unknownLiveParamError,
  unsupportedTypeError,
  videoUsage,
  waitForNextPoll,
} from './mediaHelpers.ts';
import {
  classifyByStatus,
  createProviderError,
  requestProviderJson,
  sendProviderRequest,
  type ProviderCallContext,
  type ProviderErrorCode,
} from './providerRequest.ts';
import { authorizationHeader } from './responsesApiFormat.ts';

const BASE_URL = 'https://api.x.ai/v1';
const VIDEO_POLL_INTERVAL_MS = 5000;
const SPEECH_CODEC = 'mp3';
const SPEECH_MIME_TYPE = 'audio/mpeg';
const IMAGE_MIME_TYPE = 'image/jpeg';
const VIDEO_MIME_TYPE = 'video/mp4';

type JsonObject = Record<string, unknown>;

export const grokMediaConnector: MediaConnector = {
  provider: 'grok',
  types: ['image', 'video', 'audio'],
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
  const context = callContext('listMediaModels', connection, signal);
  if (type === 'audio') {
    // 語音只有一個端點；查聲音清單順便確認 key 有效
    await listVoices(context, connection);
    return [grokSpeechModel()];
  }
  const body = await getJson(context, connection, modelsPath(type));
  return asArray(body.models)
    .map(asRecord)
    .map((model) => toGrokMediaModel(type, model));
}

// ===== 確認模型、即時選項 =====

async function checkMediaModel(
  type: MediaModelType,
  model: string,
  connection: MediaConnection,
  signal?: AbortSignal,
): Promise<void> {
  const context = callContext('checkMediaModel', connection, signal);
  if (type === 'audio') {
    await listVoices(context, connection);
    return;
  }
  // 查單一模型：key 無效回 401、模型不存在回 404
  await getJson(context, connection, `${modelsPath(type)}/${encodeURIComponent(model)}`);
}

async function listParamOptions(
  type: MediaModelType,
  _model: string,
  paramKey: string,
  connection: MediaConnection,
  signal?: AbortSignal,
): Promise<string[]> {
  const context = callContext('listParamOptions', connection, signal);
  if (type !== 'audio' || paramKey !== MEDIA_PARAM_KEYS.voice) {
    throw unknownLiveParamError(context, paramKey);
  }
  return listVoices(context, connection);
}

async function listVoices(
  context: ProviderCallContext,
  connection: MediaConnection,
): Promise<string[]> {
  const body = await getJson(context, connection, '/tts/voices');
  return asArray(body.voices)
    .map((voice) => asString(asRecord(voice).voice_id))
    .filter(Boolean);
}

// ===== 生成 =====

async function generateMedia(request: MediaRequest): Promise<MediaResult> {
  const context = callContext('generateMedia', request.connection, request.signal);
  if (request.type === 'image') return generateImages(request, context);
  if (request.type === 'video') return generateVideo(request, context);
  return generateSpeech(request, context);
}

/** 圖片：同步回傳 base64；有參考圖時改用改圖端點。 */
async function generateImages(
  request: MediaRequest,
  context: ProviderCallContext,
): Promise<MediaResult> {
  const references = request.input.referenceImages ?? [];
  const body: JsonObject = {
    model: request.model,
    prompt: request.input.prompt,
    response_format: 'b64_json',
    n: readNumberParam(request.params, MEDIA_PARAM_KEYS.count),
    aspect_ratio: readStringParam(request.params, MEDIA_PARAM_KEYS.aspectRatio),
    resolution: readStringParam(request.params, MEDIA_PARAM_KEYS.resolution),
  };
  // 一張用 image、多張用 images（兩者不能同時送，xAI 官方文件）
  if (references.length === 1) body.image = { url: imageToDataUrl(references[0]) };
  if (references.length > 1)
    body.images = references.map((image) => ({ url: imageToDataUrl(image) }));
  const path = references.length > 0 ? '/images/edits' : '/images/generations';
  const response = await postJson(context, request.connection, path, body);
  const files = asArray(response.data).map(asRecord).map(toImageFile);
  if (files.length === 0)
    throw createProviderError(context, 'PROVIDER_RESPONSE_INVALID', { body: response });
  return { files, usage: imageUsage(files.length) };
}

function toImageFile(item: JsonObject): MediaFile {
  return base64ToFile(asString(item.b64_json), asString(item.mime_type) || IMAGE_MIME_TYPE);
}

/** 影片：送出後每隔一段時間查進度，完成後下載影片。 */
async function generateVideo(
  request: MediaRequest,
  context: ProviderCallContext,
): Promise<MediaResult> {
  const { firstFrame } = request.input;
  const submitted = await postJson(context, request.connection, '/videos/generations', {
    model: request.model,
    prompt: request.input.prompt,
    duration: readNumberParam(request.params, MEDIA_PARAM_KEYS.duration),
    aspect_ratio: readStringParam(request.params, MEDIA_PARAM_KEYS.aspectRatio),
    resolution: readStringParam(request.params, MEDIA_PARAM_KEYS.resolution),
    image: firstFrame ? { url: imageToDataUrl(firstFrame) } : undefined,
  });
  const requestId = asString(submitted.request_id);
  if (!requestId)
    throw createProviderError(context, 'PROVIDER_RESPONSE_INVALID', { body: submitted });
  const done = await waitForVideo(request, context, requestId);
  const video = asRecord(done.video);
  // respect_moderation 為 false 代表被審查擋下，網址是空的
  if (video.respect_moderation === false || !asString(video.url)) {
    throw createProviderError(context, 'PROVIDER_REQUEST_REFUSED', { body: done });
  }
  const file = await downloadFile(
    asString(video.url),
    context,
    { classifyError: classifyByStatus },
    VIDEO_MIME_TYPE,
  );
  return { files: [file], usage: videoUsage(asNumber(video.duration)) };
}

/** 查進度直到完成；失敗或過期時丟出錯誤。 */
async function waitForVideo(
  request: MediaRequest,
  context: ProviderCallContext,
  requestId: string,
): Promise<JsonObject> {
  for (;;) {
    const status = await getJson(
      context,
      request.connection,
      `/videos/${encodeURIComponent(requestId)}`,
    );
    const state = asString(status.status);
    if (state === 'done') return status;
    if (state === 'failed' || state === 'expired') {
      throw createProviderError(context, videoFailureCode(status), { body: status });
    }
    const percent = typeof status.progress === 'number' ? status.progress : undefined;
    request.onProgress?.({ status: 'running', percent });
    await waitForNextPoll(VIDEO_POLL_INTERVAL_MS, context);
  }
}

/** xAI 任務失敗的錯誤代碼對應到平台的錯誤代碼。 */
function videoFailureCode(status: JsonObject): ProviderErrorCode {
  const code = asString(asRecord(status.error).code);
  if (code === 'invalid_argument' || code === 'failed_precondition') return 'PROVIDER_BAD_REQUEST';
  if (code === 'permission_denied') return 'PROVIDER_REQUEST_REFUSED';
  return 'PROVIDER_SERVER_ERROR';
}

/** 語音：回應內容就是音檔。 */
async function generateSpeech(
  request: MediaRequest,
  context: ProviderCallContext,
): Promise<MediaResult> {
  const text = request.input.prompt;
  const response = await sendProviderRequest({
    ...context,
    url: `${BASE_URL}/tts`,
    headers: authorizationHeader(requireApiKey(request.connection, context)),
    body: {
      text,
      voice_id: readStringParam(request.params, MEDIA_PARAM_KEYS.voice) ?? GROK_DEFAULT_VOICE,
      language: readStringParam(request.params, MEDIA_PARAM_KEYS.language) ?? 'auto',
      speed: readNumberParam(request.params, MEDIA_PARAM_KEYS.speed),
      output_format: { codec: SPEECH_CODEC },
    },
    classifyError: classifyByStatus,
  });
  const file = await readResponseFile(response, context, SPEECH_MIME_TYPE);
  return { files: [file], usage: speechUsage(text) };
}

// ===== 輔助 =====

function callContext(
  interfaceName: string,
  connection: MediaConnection,
  signal?: AbortSignal,
): ProviderCallContext {
  return { provider: 'grok', interfaceName, apiKey: connection.apiKey, signal };
}

function modelsPath(type: MediaModelType): string {
  if (type === 'image') return '/image-generation-models';
  if (type === 'video') return '/video-generation-models';
  throw unsupportedTypeError({ provider: 'grok', interfaceName: 'listMediaModels' }, type);
}

function getJson(
  context: ProviderCallContext,
  connection: MediaConnection,
  path: string,
): Promise<JsonObject> {
  return requestProviderJson<JsonObject>({
    ...context,
    url: `${BASE_URL}${path}`,
    headers: authorizationHeader(requireApiKey(connection, context)),
    classifyError: classifyByStatus,
  });
}

function postJson(
  context: ProviderCallContext,
  connection: MediaConnection,
  path: string,
  body: JsonObject,
): Promise<JsonObject> {
  return requestProviderJson<JsonObject>({
    ...context,
    url: `${BASE_URL}${path}`,
    headers: authorizationHeader(requireApiKey(connection, context)),
    body,
    classifyError: classifyByStatus,
  });
}
