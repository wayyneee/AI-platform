// OpenRouter 的圖片、影片、語音串接：請求格式、結果與用量、進度、錯誤代碼、模型清單與可調參數。回應範例依 OpenRouter 官方文件的形狀。

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaProgress } from '../../../shared/PlatformInfrastructure/types.ts';
import type { MediaRequest } from './connectorTypes.ts';
import { openRouterMediaConnector } from './openRouterMedia.ts';
import {
  binaryReply,
  catchAsyncError,
  jsonReply,
  mockFetch,
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
    model: 'google/gemini-3-pro-image',
    connection,
    input: { prompt: '一隻貓坐在窗邊' },
    params: {},
    ...overrides,
  };
}

const IMAGE_RESPONSE = {
  created: 1748458800,
  data: [{ b64_json: TINY_PNG, media_type: 'image/png' }],
  usage: { prompt_tokens: 12, completion_tokens: 1290, total_tokens: 1302, cost: 0.039 },
};

describe('圖片、影片、語音的參數、參考圖、第一個畫面正確轉成 OpenRouter 的格式；結果、進度、用量正確取出', () => {
  it('文字生圖：張數、比例、解析度、品質、種子轉成 OpenRouter 欄位，用量為張數', async () => {
    const requests = mockFetch(jsonReply(IMAGE_RESPONSE));
    const result = await openRouterMediaConnector.generateMedia(
      mediaRequest({
        params: { count: 1, aspectRatio: '16:9', resolution: '2K', quality: 'high', seed: 42 },
      }),
    );
    expect(requests[0].url).toBe('https://openrouter.ai/api/v1/images');
    expect(requests[0].headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    expect(requests[0].body).toEqual({
      model: 'google/gemini-3-pro-image',
      prompt: '一隻貓坐在窗邊',
      n: 1,
      aspect_ratio: '16:9',
      resolution: '2K',
      quality: 'high',
      seed: 42,
    });
    expect(result.files[0].mimeType).toBe('image/png');
    expect(Buffer.from(result.files[0].data).toString('base64')).toBe(TINY_PNG);
    expect(result.usage).toEqual({ imageCount: 1, videoSeconds: 0, characterCount: 0 });
  });

  it('附參考圖時放進 input_references（改圖）', async () => {
    const requests = mockFetch(jsonReply(IMAGE_RESPONSE));
    await openRouterMediaConnector.generateMedia(
      mediaRequest({ input: { prompt: '改成夜晚', referenceImages: [PNG_IMAGE] } }),
    );
    expect(requests[0].body?.input_references).toEqual([
      { type: 'image_url', image_url: { url: `data:image/png;base64,${TINY_PNG}` } },
    ]);
  });

  it('影片：送出後查進度（排隊中、處理中的百分比），完成後下載，用量為送出的秒數', async () => {
    vi.useFakeTimers();
    const requests = mockFetch(
      jsonReply({ id: 'job_1', polling_url: '/api/v1/videos/job_1', status: 'pending' }, 202),
      jsonReply({ id: 'job_1', status: 'pending', status_detail: 'queued_at_provider' }),
      jsonReply({ id: 'job_1', status: 'in_progress', status_detail: 'generating', progress: 60 }),
      jsonReply({ id: 'job_1', status: 'completed', usage: { cost: 3.2, is_byok: false } }),
      binaryReply(VIDEO_BYTES, 'video/mp4'),
    );
    const progress: MediaProgress[] = [];
    const result = await settleWithFakeTimers(
      openRouterMediaConnector.generateMedia(
        mediaRequest({
          type: 'video',
          model: 'google/veo-3.1',
          input: { prompt: '讓貓轉頭', firstFrame: PNG_IMAGE },
          params: { duration: '8', resolution: '720p', aspectRatio: '16:9', generateAudio: false },
          onProgress: (value) => progress.push(value),
        }),
      ),
    );
    expect(requests[0].url).toBe('https://openrouter.ai/api/v1/videos');
    expect(requests[0].body).toEqual({
      model: 'google/veo-3.1',
      prompt: '讓貓轉頭',
      duration: 8,
      resolution: '720p',
      aspect_ratio: '16:9',
      generate_audio: false,
      frame_images: [
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${TINY_PNG}` },
          frame_type: 'first_frame',
        },
      ],
    });
    expect(requests[1].url).toBe('https://openrouter.ai/api/v1/videos/job_1');
    expect(requests[4].url).toBe('https://openrouter.ai/api/v1/videos/job_1/content?index=0');
    expect(requests[4].headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    expect(progress).toEqual([{ status: 'queued' }, { status: 'running', percent: 60 }]);
    expect(result.files[0]).toEqual({ mimeType: 'video/mp4', data: VIDEO_BYTES });
    expect(result.usage).toEqual({ imageCount: 0, videoSeconds: 8, characterCount: 0 });
  });

  it('語音：文字、聲音、語速轉成 OpenRouter 欄位，固定 mp3，用量為輸入字數', async () => {
    const requests = mockFetch(binaryReply(AUDIO_BYTES, 'audio/mpeg'));
    const result = await openRouterMediaConnector.generateMedia(
      mediaRequest({
        type: 'audio',
        model: 'openai/gpt-4o-mini-tts',
        input: { prompt: '你好，世界' },
        params: { voice: 'alloy', speed: 1.25 },
      }),
    );
    expect(requests[0].url).toBe('https://openrouter.ai/api/v1/audio/speech');
    expect(requests[0].body).toEqual({
      model: 'openai/gpt-4o-mini-tts',
      input: '你好，世界',
      voice: 'alloy',
      speed: 1.25,
      response_format: 'mp3',
    });
    expect(result.files[0]).toEqual({ mimeType: 'audio/mpeg', data: AUDIO_BYTES });
    expect(result.usage.characterCount).toBe(5);
  });
});

describe('OpenRouter 圖片、影片、語音的錯誤對應到正確的錯誤代碼', () => {
  it('影片因內容審查失敗時回報被拒絕，細節附上原始內容', async () => {
    mockFetch(
      jsonReply({ id: 'job_2', status: 'pending' }, 202),
      jsonReply({
        id: 'job_2',
        status: 'failed',
        error: {
          message: 'Request blocked by provider safety filter',
          metadata: { error_type: 'content_policy_violation' },
        },
      }),
    );
    const error = await catchAsyncError(() =>
      openRouterMediaConnector.generateMedia(
        mediaRequest({ type: 'video', model: 'google/veo-3.1' }),
      ),
    );
    expect(error.code).toBe('PROVIDER_REQUEST_REFUSED');
    expect(JSON.stringify(error.details)).toContain('safety filter');
  });

  it('影片過期時回報供應商服務錯誤', async () => {
    mockFetch(
      jsonReply({ id: 'job_3', status: 'pending' }, 202),
      jsonReply({ id: 'job_3', status: 'expired' }),
    );
    const error = await catchAsyncError(() =>
      openRouterMediaConnector.generateMedia(
        mediaRequest({ type: 'video', model: 'google/veo-3.1' }),
      ),
    );
    expect(error.code).toBe('PROVIDER_SERVER_ERROR');
  });

  it('HTTP 200 的內容裡有 error 時，依裡面的狀態碼對應錯誤代碼', async () => {
    mockFetch(jsonReply({ error: { code: 402, message: 'Insufficient credits' } }));
    const error = await catchAsyncError(() =>
      openRouterMediaConnector.generateMedia(mediaRequest({})),
    );
    expect(error.code).toBe('PROVIDER_QUOTA_EXCEEDED');
  });

  it('語音回傳 JSON 錯誤而不是音檔時，依錯誤內容回報', async () => {
    mockFetch(jsonReply({ error: { code: 400, message: 'voice is required' } }));
    const error = await catchAsyncError(() =>
      openRouterMediaConnector.generateMedia(mediaRequest({ type: 'audio', model: 'x/tts' })),
    );
    expect(error.code).toBe('PROVIDER_BAD_REQUEST');
  });

  it('key 無效時回報 key 無效，細節不含 key', async () => {
    mockFetch(jsonReply({ error: { code: 401, message: `bad key ${TEST_API_KEY}` } }, 401));
    const error = await catchAsyncError(() =>
      openRouterMediaConnector.generateMedia(mediaRequest({})),
    );
    expect(error.code).toBe('PROVIDER_KEY_INVALID');
    expect(JSON.stringify(error.details)).not.toContain(TEST_API_KEY);
  });
});

describe('OpenRouter 圖片、影片、語音的模型清單與可調參數依 API 回報的可選值產生', () => {
  it('圖片模型：依 supported_parameters 列出參數，enum 為選單、range 為數字，沒有回報的參數不列', async () => {
    const requests = mockFetch(
      jsonReply({
        data: [
          {
            id: 'google/gemini-3-pro-image',
            name: 'Google: Nano Banana Pro',
            description: '生成、修改圖片',
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
            supported_parameters: {
              n: { type: 'range', min: 1, max: 4 },
              aspect_ratio: { type: 'enum', values: ['1:1', '16:9'] },
              resolution: { type: 'enum', values: ['1K', '2K', '4K'] },
              input_references: { type: 'range', min: 0, max: 14 },
              output_format: { type: 'enum', values: ['png', 'jpeg'] },
            },
          },
        ],
      }),
    );
    const [model] = await openRouterMediaConnector.listMediaModels('image', connection);
    expect(requests[0].url).toBe('https://openrouter.ai/api/v1/images/models');
    expect(model).toMatchObject({
      id: 'google/gemini-3-pro-image',
      displayName: 'Google: Nano Banana Pro',
      description: '生成、修改圖片',
      inputKinds: ['text', 'image'],
      outputKinds: ['image'],
    });
    expect(model.price).toBeUndefined();
    expect(model.params).toEqual([
      { key: 'count', kind: 'number', min: 1, max: 4, isInteger: true },
      { key: 'aspectRatio', kind: 'select', options: ['1:1', '16:9'] },
      { key: 'resolution', kind: 'select', options: ['1K', '2K', '4K'] },
    ]);
  });

  it('影片模型：秒數、解析度、比例、聲音、種子依回報的值產生，秒數預設最短的', async () => {
    mockFetch(
      jsonReply({
        data: [
          {
            id: 'google/veo-3.1',
            name: 'Google: Veo 3.1',
            supported_durations: [8, 4, 6],
            supported_resolutions: ['720p', '1080p'],
            supported_aspect_ratios: ['16:9', '9:16'],
            supported_frame_images: ['first_frame', 'last_frame'],
            generate_audio: true,
            seed: true,
            pricing_skus: { duration_seconds_with_audio: '0.40' },
          },
        ],
      }),
    );
    const [model] = await openRouterMediaConnector.listMediaModels('video', connection);
    expect(model.params).toEqual([
      { key: 'duration', kind: 'select', options: ['8', '4', '6'], default: '4' },
      { key: 'resolution', kind: 'select', options: ['720p', '1080p'] },
      { key: 'aspectRatio', kind: 'select', options: ['16:9', '9:16'] },
      { key: 'generateAudio', kind: 'boolean', default: true },
      { key: 'seed', kind: 'number', isInteger: true },
    ]);
    expect(model.inputKinds).toEqual(['text', 'image']);
  });

  it('語音模型：聲音選單預設第一個、語速範圍；沒有公開聲音清單時不列聲音', async () => {
    mockFetch(
      jsonReply({
        data: [
          {
            id: 'openai/gpt-4o-mini-tts',
            name: 'OpenAI: GPT-4o mini TTS',
            input_modalities: [{ type: 'text' }],
            output_modalities: [
              {
                type: 'speech',
                supported_parameters: {
                  voice: { type: 'enum', values: ['alloy', 'nova'] },
                  response_format: { type: 'enum', values: ['mp3', 'pcm'] },
                  speed: { type: 'range', min: 0.25, max: 4 },
                },
              },
            ],
          },
          {
            id: 'other/tts',
            name: 'Other TTS',
            output_modalities: [
              { type: 'speech', supported_parameters: { voice: { type: 'unknown' } } },
            ],
          },
        ],
      }),
    );
    const [openAi, other] = await openRouterMediaConnector.listMediaModels('audio', connection);
    expect(openAi.params).toEqual([
      { key: 'voice', kind: 'select', options: ['alloy', 'nova'], default: 'alloy' },
      { key: 'speed', kind: 'number', min: 0.25, max: 4 },
    ]);
    expect(openAi.inputKinds).toEqual(['text']);
    expect(other.params).toEqual([]);
  });

  it('確認模型：先查 key 是否有效，再確認模型在清單中，不實際生成', async () => {
    const models = jsonReply({ data: [{ id: 'google/veo-3.1', name: 'Veo' }] });
    const requests = mockFetch(jsonReply({ data: { label: 'my key' } }), models);
    await openRouterMediaConnector.checkMediaModel('video', 'google/veo-3.1', connection);
    expect(requests.map((request) => request.url)).toEqual([
      'https://openrouter.ai/api/v1/key',
      'https://openrouter.ai/api/v1/videos/models',
    ]);

    mockFetch(jsonReply({ data: { label: 'my key' } }), models);
    const missing = await catchAsyncError(() =>
      openRouterMediaConnector.checkMediaModel('video', 'no/such-model', connection),
    );
    expect(missing.code).toBe('PROVIDER_MODEL_NOT_FOUND');

    mockFetch(jsonReply({ error: { code: 401, message: 'No auth credentials found' } }, 401));
    const invalid = await catchAsyncError(() =>
      openRouterMediaConnector.checkMediaModel('video', 'google/veo-3.1', connection),
    );
    expect(invalid.code).toBe('PROVIDER_KEY_INVALID');
  });
});
