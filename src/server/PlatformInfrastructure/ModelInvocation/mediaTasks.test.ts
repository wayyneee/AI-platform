// 圖片、影片、語音的生成任務：從排隊到完成、只能取一次、Forge 一次一個、影片 30 分鐘逾時、一個任務一筆 log。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  MediaResult,
  MediaTask,
  MediaTaskRequest,
  SavedModel,
} from '../../../shared/PlatformInfrastructure/types.ts';
import type { MediaRequest } from '../ProviderConnectors/index.ts';
import { getTask, submitTask } from './mediaTasks.ts';
import {
  fakeMedia,
  flushPromises,
  IMAGE_MODEL,
  IMAGE_RESULT,
  LLM_MODEL,
  providerError,
  saveCloudModel,
  saveForgeModel,
  setUpInvocationTest,
  startLogWatch,
  tearDownInvocationTest,
  VIDEO_MODEL,
} from './invocationTestSupport.ts';

vi.mock('../ProviderConnectors/index.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('./invocationTestSupport.ts')).fakeProviderConnectors,
}));

const MEDIA_CALLER = 'MediaCreation';
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

beforeEach(() => {
  setUpInvocationTest();
});

afterEach(() => {
  vi.useRealTimers();
  tearDownInvocationTest();
});

// ===== 輔助 =====

/** 由測試決定什麼時候生成完成：記下每次送給供應商的請求，等測試呼叫 finish。 */
function holdGeneration() {
  const pending: { request: MediaRequest; finish: (result: MediaResult) => void }[] = [];
  fakeMedia.generateMedia.mockImplementation(
    (request) =>
      new Promise<MediaResult>((resolve, reject) => {
        pending.push({ request, finish: resolve });
        request.signal?.addEventListener('abort', () =>
          reject(providerError('PROVIDER_CANCELLED', 'generateMedia')),
        );
      }),
  );
  return pending;
}

function taskRequest(model: SavedModel, overrides: Partial<MediaTaskRequest> = {}) {
  return {
    callerModule: MEDIA_CALLER,
    modelId: model.id,
    params: {},
    input: { prompt: '一隻貓' },
    ...overrides,
  };
}

/** 一直查到任務結束（完成或失敗），回傳最後一次查到的任務。 */
async function waitForTaskEnd(id: string): Promise<MediaTask> {
  for (let round = 0; round < 50; round += 1) {
    const task = getTask(id);
    if (task.status === 'succeeded' || task.status === 'failed') return task;
    await flushPromises();
  }
  throw new Error(`任務 ${id} 一直沒有結束`);
}

async function rejectionOf(promise: Promise<unknown>) {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

// ===== 從排隊到完成 =====

describe('任務的流程', () => {
  it('任務依序從排隊到完成，供應商有百分比時帶上進度', async () => {
    const model = await saveCloudModel(IMAGE_MODEL, 'grok');
    const pending = holdGeneration();
    const referenceImages = [{ mimeType: 'image/png', data: 'AAAA' }];
    const submitted = await submitTask(
      taskRequest(model, { input: { prompt: '改成水彩', referenceImages } }),
    );
    expect(submitted.status).toBe('queued');

    await flushPromises();
    expect(getTask(submitted.id).status).toBe('running');
    pending[0].request.onProgress?.({ status: 'running', percent: 40 });
    expect(getTask(submitted.id)).toMatchObject({ status: 'running', percent: 40 });
    // 參考圖原樣交給供應商串接；沒填的參數用預設值
    expect(pending[0].request).toMatchObject({
      input: { referenceImages },
      params: { count: 1 },
    });

    pending[0].finish(IMAGE_RESULT);
    const finished = await waitForTaskEnd(submitted.id);
    expect(finished).toMatchObject({ status: 'succeeded', result: IMAGE_RESULT });
    expect(finished.percent).toBeUndefined();
  });

  it('完成後只能取一次', async () => {
    const model = await saveCloudModel(IMAGE_MODEL, 'grok');
    const { id } = await submitTask(taskRequest(model));
    await waitForTaskEnd(id);
    expect(() => getTask(id)).toThrow(
      expect.objectContaining({ code: 'INVOCATION_TASK_NOT_FOUND' }),
    );
  });

  it('生成失敗時任務標為失敗並帶上錯誤', async () => {
    const model = await saveCloudModel(IMAGE_MODEL, 'grok');
    fakeMedia.generateMedia.mockRejectedValueOnce(
      providerError('PROVIDER_SERVER_ERROR', 'generateMedia'),
    );
    const { id } = await submitTask(taskRequest(model));
    expect(await waitForTaskEnd(id)).toMatchObject({
      status: 'failed',
      error: { code: 'PROVIDER_SERVER_ERROR' },
    });
  });
});

// ===== 送出前的檢查 =====

describe('送出前的檢查', () => {
  it('參數超出範圍時送出就回報錯誤，不建立任務', async () => {
    const model = await saveCloudModel(IMAGE_MODEL, 'grok');
    const error = await rejectionOf(submitTask(taskRequest(model, { params: { count: 20 } })));
    expect(error).toMatchObject({ code: 'INVOCATION_PARAM_INVALID', interfaceName: 'submitTask' });
    expect(fakeMedia.generateMedia).not.toHaveBeenCalled();
  });

  it('即時選項（Forge 的取樣器）不在目前的清單中時回報錯誤', async () => {
    const model = await saveForgeModel();
    const error = await rejectionOf(
      submitTask(taskRequest(model, { params: { sampler: 'Unknown Sampler' } })),
    );
    expect(error).toMatchObject({ code: 'INVOCATION_PARAM_INVALID' });
  });

  it('LLM 模型不能送生成任務', async () => {
    const model = await saveCloudModel(LLM_MODEL);
    const error = await rejectionOf(submitTask(taskRequest(model)));
    expect(error).toMatchObject({ code: 'INVOCATION_MODEL_TYPE_MISMATCH' });
  });
});

// ===== Forge 排隊 =====

describe('Forge 排隊', () => {
  it('同一個 Forge 一次只跑一個，其他的排隊；Forge 不記錄花費', async () => {
    const model = await saveForgeModel();
    const pending = holdGeneration();
    const first = await submitTask(taskRequest(model));
    const second = await submitTask(taskRequest(model));
    await flushPromises();
    expect(fakeMedia.generateMedia).toHaveBeenCalledTimes(1);
    expect(getTask(second.id).status).toBe('queued');

    pending[0].finish(IMAGE_RESULT);
    expect(await waitForTaskEnd(first.id)).toMatchObject({ status: 'succeeded', cost: null });
    await flushPromises();
    expect(fakeMedia.generateMedia).toHaveBeenCalledTimes(2);
    expect(getTask(second.id).status).toBe('running');
    pending[1].finish(IMAGE_RESULT);
    await waitForTaskEnd(second.id);
  });

  it('不同位址的 Forge 可以同時跑', async () => {
    const local = await saveForgeModel('http://127.0.0.1:7860');
    const other = await saveForgeModel('http://192.168.0.10:7860');
    holdGeneration();
    await submitTask(taskRequest(local));
    await submitTask(taskRequest(other));
    await flushPromises();
    expect(fakeMedia.generateMedia).toHaveBeenCalledTimes(2);
  });
});

// ===== 影片逾時 =====

describe('影片逾時', () => {
  it('影片超過 30 分鐘還沒完成，標為失敗', async () => {
    const model = await saveCloudModel(VIDEO_MODEL, 'grok');
    holdGeneration();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { id } = await submitTask(taskRequest(model));

    await vi.advanceTimersByTimeAsync(THIRTY_MINUTES_MS - ONE_MINUTE_MS);
    expect(getTask(id).status).toBe('running');
    await vi.advanceTimersByTimeAsync(ONE_MINUTE_MS);
    expect(await waitForTaskEnd(id)).toMatchObject({
      status: 'failed',
      error: { code: 'INVOCATION_TASK_TIMED_OUT' },
    });
  });
});

// ===== log =====

describe('log', () => {
  it('一個任務剛好一筆 log；排隊和查進度期間沒有 log', async () => {
    const model = await saveCloudModel(IMAGE_MODEL, 'grok');
    const pending = holdGeneration();
    const logs = startLogWatch();
    const { id } = await submitTask(taskRequest(model));
    await flushPromises();
    pending[0].request.onProgress?.({ status: 'running', percent: 50 });
    getTask(id);
    getTask(id);
    expect(logs()).toHaveLength(0);

    pending[0].finish(IMAGE_RESULT);
    await waitForTaskEnd(id);
    expect(logs()).toEqual([
      expect.objectContaining({
        level: 'success',
        module: 'MediaCreation → PlatformInfrastructure',
        action: '生成任務：Grok Imagine Image（Grok，圖片）',
        usage: '1 張',
      }),
    ]);
  });

  it('失敗的任務也剛好一筆 log，等級依錯誤代碼', async () => {
    const model = await saveCloudModel(IMAGE_MODEL, 'grok');
    fakeMedia.generateMedia.mockRejectedValueOnce(
      providerError('PROVIDER_KEY_INVALID', 'generateMedia'),
    );
    const logs = startLogWatch();
    const { id } = await submitTask(taskRequest(model));
    await waitForTaskEnd(id);
    expect(logs()).toMatchObject([{ level: 'warning', error: { code: 'PROVIDER_KEY_INVALID' } }]);
  });
});
