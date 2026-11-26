// 圖片、影片、語音串接共用的小工具：等待下一次查進度、base64 與檔案、讀參數、整理輸入輸出類型、常見的錯誤。

import type {
  ContentKind,
  MediaFile,
  MediaImage,
  MediaModelType,
  MediaUsage,
  ParamValues,
  WeightedChoice,
} from '../../../shared/PlatformInfrastructure/types.ts';
import type { MediaConnection } from './connectorTypes.ts';
import {
  createProviderError,
  sendProviderRequest,
  toProviderError,
  type ClassifyProviderError,
  type ProviderCallContext,
} from './providerRequest.ts';

const DEFAULT_FILE_MIME_TYPE = 'application/octet-stream';

// ===== 等待 =====

/** 等一段時間再查進度；呼叫端中止時立刻丟出 PROVIDER_CANCELLED。 */
export function waitForNextPoll(milliseconds: number, context: ProviderCallContext): Promise<void> {
  const { signal } = context;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createProviderError(context, 'PROVIDER_CANCELLED'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    function onAbort(): void {
      clearTimeout(timer);
      reject(createProviderError(context, 'PROVIDER_CANCELLED'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ===== 檔案 =====

/** base64 文字（可以帶 data: 前綴）轉成檔案。 */
export function base64ToFile(data: string, mimeType: string): MediaFile {
  const commaIndex = data.startsWith('data:') ? data.indexOf(',') : -1;
  const base64 = commaIndex >= 0 ? data.slice(commaIndex + 1) : data;
  return { mimeType, data: new Uint8Array(Buffer.from(base64, 'base64')) };
}

/** 圖片轉成 data URL（Grok、OpenRouter 的圖片欄位格式）。 */
export function imageToDataUrl(image: MediaImage): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

/** 把回應的內容讀成檔案；檔案類型以回應標頭為準，沒有時用 fallbackMimeType。 */
export async function readResponseFile(
  response: Response,
  context: ProviderCallContext,
  fallbackMimeType = DEFAULT_FILE_MIME_TYPE,
): Promise<MediaFile> {
  const headerType = response.headers.get('content-type')?.split(';')[0]?.trim();
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { mimeType: headerType || fallbackMimeType, data: bytes };
  } catch (error) {
    throw toProviderError(error, context);
  }
}

/** 下載生成好的檔案（例如影片網址）。 */
export async function downloadFile(
  url: string,
  context: ProviderCallContext,
  options: { headers?: Record<string, string>; classifyError: ClassifyProviderError },
  fallbackMimeType?: string,
): Promise<MediaFile> {
  const response = await sendProviderRequest({ ...context, url, ...options });
  return readResponseFile(response, context, fallbackMimeType);
}

// ===== 用量 =====

/** 圖片的用量：以張計。 */
export function imageUsage(imageCount: number): MediaUsage {
  return { imageCount, videoSeconds: 0, characterCount: 0 };
}

/** 影片的用量：以秒計。 */
export function videoUsage(videoSeconds: number): MediaUsage {
  return { imageCount: 0, videoSeconds, characterCount: 0 };
}

/** 語音的用量：以輸入字數計；中文、emoji 都算一個字。 */
export function speechUsage(text: string): MediaUsage {
  return { imageCount: 0, videoSeconds: 0, characterCount: [...text].length };
}

// ===== 讀參數 =====

/** 讀是／否參數；沒填時回傳 undefined（交給供應商決定）。 */
export function readBooleanParam(params: ParamValues, key: string): boolean | undefined {
  const value = params[key];
  return typeof value === 'boolean' ? value : undefined;
}

/** 讀「可以選多個、各自調權重」的參數；沒填時回傳空清單。 */
export function readWeightedListParam(params: ParamValues, key: string): WeightedChoice[] {
  const value = params[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item.name !== '');
}

// ===== 輸入輸出類型 =====

/** 供應商的輸入輸出類型名稱轉成平台的類型；認不得的略過，重複的只留一個。 */
export function toContentKinds(names: string[]): ContentKind[] {
  const aliases: Record<string, ContentKind> = {
    text: 'text',
    image: 'image',
    video: 'video',
    audio: 'audio',
    speech: 'audio',
    file: 'file',
  };
  const kinds = names.map((name) => aliases[name.toLowerCase()]).filter(Boolean);
  return [...new Set(kinds)];
}

// ===== 常見的錯誤 =====

/** 取出雲端供應商的 key；沒有 key 時丟出 PROVIDER_KEY_INVALID。 */
export function requireApiKey(connection: MediaConnection, context: ProviderCallContext): string {
  if (connection.apiKey) return connection.apiKey;
  throw createProviderError(context, 'PROVIDER_KEY_INVALID', { reason: '沒有提供 API key' });
}

/** 這家沒有提供這個類型。 */
export function unsupportedTypeError(
  context: ProviderCallContext,
  type: MediaModelType,
): ReturnType<typeof createProviderError> {
  return createProviderError(context, 'PROVIDER_BAD_REQUEST', { reason: `不提供${type}類型` });
}

/** 這個參數沒有即時選項可以查。 */
export function unknownLiveParamError(
  context: ProviderCallContext,
  paramKey: string,
): ReturnType<typeof createProviderError> {
  return createProviderError(context, 'PROVIDER_BAD_REQUEST', {
    reason: `參數 ${paramKey} 沒有即時選項`,
  });
}
