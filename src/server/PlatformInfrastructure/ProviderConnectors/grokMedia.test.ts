// Grok（xAI）的圖片、影片、語音串接：請求格式、結果與用量、進度、錯誤代碼、模型清單與可調參數。回應範例依 xAI 官方文件的形狀。

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaProgress } from '../../../shared/PlatformInfrastructure/types.ts';
import type { MediaRequest } from './connectorTypes.ts';
import { grokMediaConnector } from './grokMedia.ts';
import {
  binaryReply,
  catchAsyncError,
  jsonReply,
  mockFetch,
  networkFailure,
  settleWithFakeTimers,
  TEST_API_KEY,
  TINY_PNG,
} from './providerTestSupport.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const connection = { apiKey: TEST_API_KEY };
const PNG_IMAGE = { mimeType: 'image/png', data: TINY_PNG };
const VIDEO_BYTES = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
const AUDIO_BYTES = new Uint8Array([73, 68, 51, 4]);

function mediaRequest(overrides: Partial<MediaRequest>): MediaRequest {
  return {
    type: 'image',
    model: 'grok-imagine-image-2.0',
    connection,
    input: { prompt: '一隻貓坐在窗邊' },
    params: {},
    ...overrides,
  };
}

const IMAGE_RESPONSE = {
  data: [
    { b64_json: TINY_PNG, mime_type: 'image/png' },
    { b64_json: TINY_PNG, mime_type: 'image/png' },
  ],
  usage: { cost_in_usd_ticks: 400000000 },
};

describe('圖片、影片、語音的參數、參考圖、第一個畫面正確轉成 Grok 的格式；結果、進度、用量正確取出', () => {
  it('文字生圖：張數、比例、解析度轉成 xAI 欄位，要求 base64，用量為張數', async () => {
    const requests = mockFetch(jsonReply(IMAGE_RESPONSE));
    const result = await grokMediaConnector.generateMedia(
      mediaRequest({ params: { count: 2, aspectRatio: '16:9', resolution: '2k' } }),
    );
    expect(requests[0].url).toBe('https://api.x.ai/v1/images/generations');
    expect(requests[0].headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    expect(requests[0].body).toEqual({
      model: 'grok-imagine-image-2.0',
      prompt: '一隻貓坐在窗邊',
      response_format: 'b64_json',
      n: 2,
      aspect_ratio: '16:9',
      resolution: '2k',
    });
    expect(result.files).toHaveLength(2);
    expect(result.files[0].mimeType).toBe('image/png');
    expect(Buffer.from(result.files[0].data).toString('base64')).toBe(TINY_PNG);
    expect(result.usage).toEqual({ imageCount: 2, videoSeconds: 0, characterCount: 0 });
  });

  it('附一張參考圖時改用改圖端點，圖片以 data URL 放進 image', async () => {
    const requests = mockFetch(jsonReply(IMAGE_RESPONSE));
    await grokMediaConnector.generateMedia(
      mediaRequest({ input: { prompt: '改成夜晚', referenceImages: [PNG_IMAGE] } }),
    );
    expect(requests[0].url).toBe('https://api.x.ai/v1/images/edits');
    expect(requests[0].body?.image).toEqual({ url: `data:image/png;base64,${TINY_PNG}` });
    expect(requests[0].body?.images).toBeUndefined();
  });

  it('附多張參考圖時放進 images', async () => {
    const requests = mockFetch(jsonReply(IMAGE_RESPONSE));
    await grokMediaConnector.generateMedia(
      mediaRequest({ input: { prompt: '合成', referenceImages: [PNG_IMAGE, PNG_IMAGE] } }),
    );
    expect(requests[0].body?.images).toHaveLength(2);
    expect(requests[0].body?.image).toBeUndefined();
  });

  it('影片：送出後查進度、回報百分比，完成後下載影片，用量為影片秒數', async () => {
    vi.useFakeTimers();
    const requests = mockFetch(
      jsonReply({ request_id: 'vid_1' }),
      jsonReply({ status: 'pending', progress: 0 }),
      jsonReply({ status: 'pending', progress: 45 }),
      jsonReply({
        status: 'done',
        progress: 100,
        model: 'grok-imagine-video-1.5',
        video: { url: 'https://vidgen.x.ai/vid_1.mp4', duration: 6, respect_moderation: true },
        usage: { cost_in_usd_ticks: 4800000000 },
      }),
      binaryReply(VIDEO_BYTES, 'video/mp4'),
    );
    const progress: MediaProgress[] = [];
    const result = await settleWithFakeTimers(
      grokMediaConnector.generateMedia(
        mediaRequest({
          type: 'video',
          model: 'grok-imagine-video-1.5',
          input: { prompt: '讓貓轉頭', firstFrame: PNG_IMAGE },
          params: { duration: 6, aspectRatio: '9:16', resolution: '720p' },
          onProgress: (value) => progress.push(value),
        }),
      ),
    );
    expect(requests[0].url).toBe('https://api.x.ai/v1/videos/generations');
    expect(requests[0].body).toEqual({
      model: 'grok-imagine-video-1.5',
      prompt: '讓貓轉頭',
      duration: 6,
      aspect_ratio: '9:16',
      resolution: '720p',
      image: { url: `data:image/png;base64,${TINY_PNG}` },
    });
    expect(requests[1].url).toBe('https://api.x.ai/v1/videos/vid_1');
    expect(requests[4].url).toBe('https://vidgen.x.ai/vid_1.mp4');
    expect(progress).toEqual([
      { status: 'running', percent: 0 },
      { status: 'running', percent: 45 },
    ]);
    expect(result.files[0]).toEqual({ mimeType: 'video/mp4', data: VIDEO_BYTES });
    expect(result.usage).toEqual({ imageCount: 0, videoSeconds: 6, characterCount: 0 });
  });

  it('語音：文字、聲音、語言、語速轉成 xAI 欄位，固定 mp3，用量為輸入字數', async () => {
    const requests = mockFetch(binaryReply(AUDIO_BYTES, 'audio/mpeg'));
    const result = await grokMediaConnector.generateMedia(
      mediaRequest({
        type: 'audio',
        model: 'grok-tts',
        input: { prompt: '測試語音🙂' },
        params: { voice: 'rex', language: 'zh', speed: 1.2 },
      }),
    );
    expect(requests[0].url).toBe('https://api.x.ai/v1/tts');
    expect(requests[0].body).toEqual({
      text: '測試語音🙂',
      voice_id: 'rex',
      language: 'zh',
      speed: 1.2,
      output_format: { codec: 'mp3' },
    });
    expect(result.files[0]).toEqual({ mimeType: 'audio/mpeg', data: AUDIO_BYTES });
    expect(result.usage.characterCount).toBe(5);
  });

  it('語音沒選聲音、語言時，用預設的 eve、auto', async () => {
    const requests = mockFetch(binaryReply(AUDIO_BYTES, 'audio/mpeg'));
    await grokMediaConnector.generateMedia(
      mediaRequest({ type: 'audio', model: 'grok-tts', input: { prompt: '你好' } }),
    );
    expect(requests[0].body?.voice_id).toBe('eve');
    expect(requests[0].body?.language).toBe('auto');
  });
});

describe('Grok 圖片、影片、語音的錯誤對應到正確的錯誤代碼', () => {
  it('影片任務失敗時，依 xAI 的錯誤代碼回報，細節附上原始內容', async () => {
    vi.useFakeTimers();
    mockFetch(
      jsonReply({ request_id: 'vid_2' }),
      jsonReply({
        status: 'failed',
        error: { code: 'invalid_argument', message: 'Prompt cannot be empty.' },
      }),
    );
    const error = await catchAsyncError(() =>
      settleWithFakeTimers(
        grokMediaConnector.generateMedia(
          mediaRequest({ type: 'video', model: 'grok-imagine-video' }),
        ),
      ),
    );
    expect(error.code).toBe('PROVIDER_BAD_REQUEST');
    expect(JSON.stringify(error.details)).toContain('Prompt cannot be empty.');
  });

  it('影片被審查擋下（respect_moderation 為 false）時回報被拒絕', async () => {
    mockFetch(
      jsonReply({ request_id: 'vid_3' }),
      jsonReply({ status: 'done', video: { url: '', duration: 8, respect_moderation: false } }),
    );
    const error = await catchAsyncError(() =>
      grokMediaConnector.generateMedia(
        mediaRequest({ type: 'video', model: 'grok-imagine-video' }),
      ),
    );
    expect(error.code).toBe('PROVIDER_REQUEST_REFUSED');
  });

  it('等待影片時呼叫端中止，回報已取消', async () => {
    vi.useFakeTimers();
    mockFetch(jsonReply({ request_id: 'vid_4' }), jsonReply({ status: 'pending', progress: 10 }));
    const controller = new AbortController();
    const work = grokMediaConnector.generateMedia(
      mediaRequest({ type: 'video', model: 'grok-imagine-video', signal: controller.signal }),
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    const error = await catchAsyncError(() => settleWithFakeTimers(work));
    expect(error.code).toBe('PROVIDER_CANCELLED');
  });

  it('key 無效、額度不足、連不上分別對應錯誤代碼，細節不含 key', async () => {
    mockFetch(jsonReply({ code: 'unauthorized', error: `Incorrect API key ${TEST_API_KEY}` }, 401));
    const invalid = await catchAsyncError(() => grokMediaConnector.generateMedia(mediaRequest({})));
    expect(invalid.code).toBe('PROVIDER_KEY_INVALID');
    expect(JSON.stringify(invalid.details)).not.toContain(TEST_API_KEY);

    mockFetch(jsonReply({ error: 'insufficient credits' }, 402));
    const quota = await catchAsyncError(() => grokMediaConnector.generateMedia(mediaRequest({})));
    expect(quota.code).toBe('PROVIDER_QUOTA_EXCEEDED');

    mockFetch(networkFailure());
    const unreachable = await catchAsyncError(() =>
      grokMediaConnector.generateMedia(mediaRequest({})),
    );
    expect(unreachable.code).toBe('PROVIDER_UNREACHABLE');
  });
});

describe('Grok 圖片、影片、語音的模型清單、可調參數、即時選項正確產生', () => {
  it('圖片模型：列出模型、輸入輸出類型，可調參數為張數、比例、解析度', async () => {
    const requests = mockFetch(
      jsonReply({
        models: [
          {
            id: 'grok-imagine-image-2.0',
            input_modalities: ['text', 'image'],
            output_modalities: ['image'],
            image_price: 400000000,
          },
        ],
      }),
    );
    const models = await grokMediaConnector.listMediaModels('image', connection);
    expect(requests[0].url).toBe('https://api.x.ai/v1/image-generation-models');
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: 'grok-imagine-image-2.0',
      type: 'image',
      inputKinds: ['text', 'image'],
      outputKinds: ['image'],
    });
    expect(models[0].price).toBeUndefined();
    expect(models[0].params.map((param) => param.key)).toEqual([
      'count',
      'aspectRatio',
      'resolution',
    ]);
  });

  it('影片模型：秒數 1～15、舊模型的解析度沒有 1080p', async () => {
    mockFetch(
      jsonReply({
        models: [
          {
            id: 'grok-imagine-video',
            input_modalities: ['text', 'image'],
            output_modalities: ['video'],
          },
          {
            id: 'grok-imagine-video-1.5',
            input_modalities: ['text', 'image'],
            output_modalities: ['video'],
          },
        ],
      }),
    );
    const [oldModel, newModel] = await grokMediaConnector.listMediaModels('video', connection);
    expect(oldModel.params[0]).toEqual({
      key: 'duration',
      kind: 'number',
      min: 1,
      max: 15,
      isInteger: true,
      default: 8,
    });
    expect(oldModel.params[2]).toMatchObject({ key: 'resolution', options: ['480p', '720p'] });
    expect(newModel.params[2]).toMatchObject({ options: ['480p', '720p', '1080p'] });
  });

  it('語音：查聲音清單確認 key 有效，列出一個語音模型；聲音的選項即時查詢', async () => {
    const voices = {
      voices: [
        { voice_id: 'eve', name: 'Eve', language: 'en' },
        { voice_id: 'rex', name: 'Rex', language: 'en' },
      ],
    };
    const requests = mockFetch(jsonReply(voices), jsonReply(voices));
    const models = await grokMediaConnector.listMediaModels('audio', connection);
    expect(requests[0].url).toBe('https://api.x.ai/v1/tts/voices');
    expect(models).toHaveLength(1);
    expect(models[0].params[0]).toEqual({
      key: 'voice',
      kind: 'select',
      options: [],
      default: 'eve',
      hasLiveOptions: true,
    });
    const options = await grokMediaConnector.listParamOptions(
      'audio',
      'grok-tts',
      'voice',
      connection,
    );
    expect(options).toEqual(['eve', 'rex']);
  });

  it('確認模型：查單一模型，不實際生成；模型不存在時回報找不到模型', async () => {
    const requests = mockFetch(jsonReply({ id: 'grok-imagine-video-1.5' }));
    await grokMediaConnector.checkMediaModel('video', 'grok-imagine-video-1.5', connection);
    expect(requests[0].url).toBe(
      'https://api.x.ai/v1/video-generation-models/grok-imagine-video-1.5',
    );
    expect(requests[0].method).toBe('GET');

    mockFetch(jsonReply({ error: 'model not found' }, 404));
    const error = await catchAsyncError(() =>
      grokMediaConnector.checkMediaModel('image', 'no-such-model', connection),
    );
    expect(error.code).toBe('PROVIDER_MODEL_NOT_FOUND');
  });
});
