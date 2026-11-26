// Forge 串接：文字生圖、改圖、LoRA 寫進提示詞、生成中的進度、中止、沒啟動時的錯誤、模型檔清單與即時選項。
// 回應範例依 Stable Diffusion WebUI Forge 原始碼的 API 形狀（/sdapi/v1/...）。

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaProgress } from '../../../shared/PlatformInfrastructure/types.ts';
import type { MediaRequest } from './connectorTypes.ts';
import { forgeConnector } from './forge.ts';
import { catchAsyncError, settleWithFakeTimers, TINY_PNG } from './providerTestSupport.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ADDRESS = 'http://127.0.0.1:7860';
const connection = { address: `${ADDRESS}/` };
const PNG_IMAGE = { mimeType: 'image/png', data: TINY_PNG };

interface ForgeCall {
  path: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

/** 依網址回應的假 Forge；generate 的回應可以延後（用來測生成中的進度）。 */
function mockForge(routes: Record<string, () => Response | Promise<Response>>): ForgeCall[] {
  const calls: ForgeCall[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = url.replace(ADDRESS, '');
    calls.push({
      path,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const route = routes[path];
    if (!route) return json({ detail: 'Not Found' }, 404);
    const response = await route();
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return response;
  });
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function generationResponse(imageCount: number): Response {
  return json({
    images: Array.from({ length: imageCount }, () => TINY_PNG),
    parameters: {},
    info: '{"seed": 1234}',
  });
}

function mediaRequest(overrides: Partial<MediaRequest>): MediaRequest {
  return {
    type: 'image',
    model: 'waiIllustriousSDXL_v150',
    connection,
    input: { prompt: '1girl, smile' },
    params: {},
    ...overrides,
  };
}

const PROGRESS_PATH = '/sdapi/v1/progress?skip_current_image=true';

describe('Forge 的參數、參考圖、LoRA 正確轉成 Forge 的格式；結果、進度、用量正確取出', () => {
  it('文字生圖：模型檔、張數、尺寸、步數、CFG、取樣器、種子轉成 txt2img 欄位，用量為張數', async () => {
    const calls = mockForge({ '/sdapi/v1/txt2img': () => generationResponse(2) });
    const result = await forgeConnector.generateMedia(
      mediaRequest({
        input: { prompt: '1girl, smile', negativePrompt: 'lowres' },
        params: {
          count: 2,
          width: 832,
          height: 1216,
          steps: 28,
          cfgScale: 5.5,
          sampler: 'Euler a',
          scheduler: 'Karras',
          seed: 42,
          denoisingStrength: 0.5,
        },
      }),
    );
    expect(calls[0].path).toBe('/sdapi/v1/txt2img');
    expect(calls[0].body).toEqual({
      prompt: '1girl, smile',
      negative_prompt: 'lowres',
      batch_size: 2,
      width: 832,
      height: 1216,
      steps: 28,
      cfg_scale: 5.5,
      sampler_name: 'Euler a',
      scheduler: 'Karras',
      seed: 42,
      override_settings: { sd_model_checkpoint: 'waiIllustriousSDXL_v150', return_grid: false },
      send_images: true,
      save_images: false,
    });
    expect(result.files).toHaveLength(2);
    expect(result.files[0].mimeType).toBe('image/png');
    expect(Buffer.from(result.files[0].data).toString('base64')).toBe(TINY_PNG);
    expect(result.usage).toEqual({ imageCount: 2, videoSeconds: 0, characterCount: 0 });
  });

  it('多個 LoRA 依各自的權重寫進提示詞', async () => {
    const calls = mockForge({ '/sdapi/v1/txt2img': () => generationResponse(1) });
    await forgeConnector.generateMedia(
      mediaRequest({
        params: {
          loras: [
            { name: 'myCharacter', weight: 0.8 },
            { name: 'watercolorStyle', weight: 0.5 },
          ],
        },
      }),
    );
    expect(calls[0].body?.prompt).toBe(
      '1girl, smile <lora:myCharacter:0.8> <lora:watercolorStyle:0.5>',
    );
  });

  it('附參考圖時改用 img2img 改圖，帶上原圖與重畫程度', async () => {
    const calls = mockForge({ '/sdapi/v1/img2img': () => generationResponse(1) });
    await forgeConnector.generateMedia(
      mediaRequest({
        input: { prompt: 'night', referenceImages: [PNG_IMAGE] },
        params: { denoisingStrength: 0.6 },
      }),
    );
    expect(calls[0].path).toBe('/sdapi/v1/img2img');
    expect(calls[0].body?.init_images).toEqual([TINY_PNG]);
    expect(calls[0].body?.denoising_strength).toBe(0.6);
  });

  it('回傳的圖片比要求的張數多（例如附加的圖）時，只取要求的張數', async () => {
    mockForge({ '/sdapi/v1/txt2img': () => generationResponse(3) });
    const result = await forgeConnector.generateMedia(mediaRequest({ params: { count: 2 } }));
    expect(result.files).toHaveLength(2);
  });

  it('生成期間查進度：還沒開始為排隊中，開始後回報百分比；完成後不再查', async () => {
    vi.useFakeTimers();
    let progressCalls = 0;
    let finishGeneration: () => void = () => undefined;
    const generationDone = new Promise<void>((resolve) => {
      finishGeneration = resolve;
    });
    const progressReplies = [
      { progress: 0, eta_relative: 0, state: { job_count: 0 } },
      { progress: 0.42, eta_relative: 3.5, state: { job_count: 1, sampling_step: 12 } },
    ];
    const calls = mockForge({
      '/sdapi/v1/txt2img': async () => {
        await generationDone;
        return generationResponse(1);
      },
      [PROGRESS_PATH]: () => {
        const reply = progressReplies[Math.min(progressCalls, progressReplies.length - 1)];
        progressCalls += 1;
        if (progressCalls === progressReplies.length) finishGeneration();
        return json(reply);
      },
    });
    const progress: MediaProgress[] = [];
    await settleWithFakeTimers(
      forgeConnector.generateMedia(mediaRequest({ onProgress: (value) => progress.push(value) })),
    );
    expect(progress).toEqual([{ status: 'queued' }, { status: 'running', percent: 42 }]);
    const callsAtFinish = calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls.length).toBe(callsAtFinish);
  });

  it('呼叫端中止時回報已取消，並請 Forge 停下目前的生成', async () => {
    const controller = new AbortController();
    const calls = mockForge({
      '/sdapi/v1/txt2img': async () => {
        controller.abort();
        return generationResponse(1);
      },
      '/sdapi/v1/interrupt': () => json({}),
    });
    const error = await catchAsyncError(() =>
      forgeConnector.generateMedia(mediaRequest({ signal: controller.signal })),
    );
    expect(error.code).toBe('PROVIDER_CANCELLED');
    expect(
      calls.some((call) => call.path === '/sdapi/v1/interrupt' && call.method === 'POST'),
    ).toBe(true);
  });
});

describe('Forge 的錯誤對應到正確的錯誤代碼', () => {
  it('Forge 沒有啟動（連不上）時，回報請先啟動 Forge', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') });
    });
    const error = await catchAsyncError(() => forgeConnector.listMediaModels('image', connection));
    expect(error.code).toBe('PROVIDER_FORGE_NOT_RUNNING');
    expect(JSON.stringify(error.details)).toContain(ADDRESS);
  });

  it('Forge 啟動時沒加 --api（API 路徑回 404）時，也回報請先啟動 Forge', async () => {
    mockForge({});
    const error = await catchAsyncError(() => forgeConnector.listMediaModels('image', connection));
    expect(error.code).toBe('PROVIDER_FORGE_NOT_RUNNING');
  });

  it('參數不被 Forge 接受（422）時回報供應商不接受', async () => {
    mockForge({
      '/sdapi/v1/txt2img': () => json({ detail: [{ msg: 'value is not a valid integer' }] }, 422),
    });
    const error = await catchAsyncError(() => forgeConnector.generateMedia(mediaRequest({})));
    expect(error.code).toBe('PROVIDER_BAD_REQUEST');
  });

  it('沒有填 Forge 位址時回報錯誤', async () => {
    const error = await catchAsyncError(() => forgeConnector.listMediaModels('image', {}));
    expect(error.code).toBe('PROVIDER_BAD_REQUEST');
  });
});

describe('Forge 的模型檔清單、可調參數、即時選項正確產生', () => {
  const SD_MODELS = [
    {
      title: 'waiIllustriousSDXL_v150.safetensors [befc694a29]',
      model_name: 'waiIllustriousSDXL_v150',
      hash: 'befc694a29',
      sha256: null,
      filename: 'D:\\forge\\models\\Stable-diffusion\\waiIllustriousSDXL_v150.safetensors',
      config: null,
    },
    {
      title: 'animagineXL_v40.safetensors',
      model_name: 'animagineXL_v40',
      hash: null,
      sha256: null,
      filename: 'D:\\forge\\models\\Stable-diffusion\\animagineXL_v40.safetensors',
      config: null,
    },
  ];

  it('每個模型檔是一個模型；可調參數含 LoRA（可選多個、各自調權重）與即時查詢的取樣器', async () => {
    mockForge({ '/sdapi/v1/sd-models': () => json(SD_MODELS) });
    const models = await forgeConnector.listMediaModels('image', connection);
    expect(models.map((model) => model.id)).toEqual(['waiIllustriousSDXL_v150', 'animagineXL_v40']);
    expect(models[0]).toMatchObject({
      type: 'image',
      inputKinds: ['text', 'image'],
      outputKinds: ['image'],
    });
    expect(models[0].price).toBeUndefined();
    const keys = models[0].params.map((param) => param.key);
    expect(keys).toEqual([
      'count',
      'width',
      'height',
      'steps',
      'cfgScale',
      'sampler',
      'scheduler',
      'seed',
      'denoisingStrength',
      'loras',
    ]);
    expect(models[0].params.at(-1)).toEqual({
      key: 'loras',
      kind: 'weightedList',
      options: [],
      weight: { min: -2, max: 2, default: 1 },
      hasLiveOptions: true,
    });
  });

  it('LoRA、取樣器、排程器的選項即時向 Forge 查詢', async () => {
    mockForge({
      '/sdapi/v1/loras': () =>
        json([
          {
            name: 'myCharacter',
            alias: 'myCharacter',
            path: 'D:\\lora\\myCharacter.safetensors',
            metadata: {},
          },
        ]),
      '/sdapi/v1/samplers': () => json([{ name: 'Euler a', aliases: ['k_euler_a'], options: {} }]),
      '/sdapi/v1/schedulers': () => json([{ name: 'karras', label: 'Karras', aliases: null }]),
    });
    const model = 'waiIllustriousSDXL_v150';
    expect(await forgeConnector.listParamOptions('image', model, 'loras', connection)).toEqual([
      'myCharacter',
    ]);
    expect(await forgeConnector.listParamOptions('image', model, 'sampler', connection)).toEqual([
      'Euler a',
    ]);
    expect(await forgeConnector.listParamOptions('image', model, 'scheduler', connection)).toEqual([
      'karras',
    ]);
  });

  it('確認模型：模型檔存在就通過，不實際生成；不存在時回報找不到模型', async () => {
    const calls = mockForge({ '/sdapi/v1/sd-models': () => json(SD_MODELS) });
    await forgeConnector.checkMediaModel('image', 'animagineXL_v40', connection);
    expect(calls.map((call) => call.path)).toEqual(['/sdapi/v1/sd-models']);
    const error = await catchAsyncError(() =>
      forgeConnector.checkMediaModel('image', 'deleted_model', connection),
    );
    expect(error.code).toBe('PROVIDER_MODEL_NOT_FOUND');
  });
});
