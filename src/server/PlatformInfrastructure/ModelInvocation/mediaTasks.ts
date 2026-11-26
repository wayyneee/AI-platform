// 圖片、影片、語音的生成任務：送出後由後端追蹤進度、取回結果，使用者切換頁面或關閉分頁都會繼續。
// 任務只存在記憶體（spec 重要決定：任務不存檔），平台關閉就消失；完成或失敗的任務被取走一次後就移除。
// 同一個 Forge 位址一次只執行一個任務，其他的排隊；影片超過 30 分鐘還沒完成視為失敗。

import { randomUUID } from 'node:crypto';

import type {
  MediaInput,
  MediaModelType,
  MediaProgress,
  MediaTask,
  MediaTaskRequest,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { createError, defineErrorCodes, logFailure, toPlainError } from '../SystemLog/index.ts';
import {
  prepareInvocation,
  requireMediaConnector,
  type PreparedInvocation,
} from './invocationSetup.ts';
import { startInvocationLog, type InvocationLog } from './invocationLog.ts';

const MODULE_NAME = 'PlatformInfrastructure';
const SUBMIT_INTERFACE = 'submitTask';
const FORGE_PROVIDER = 'forge';
const VIDEO_TIME_LIMIT_MINUTES = 30;
const VIDEO_TIME_LIMIT_MS = VIDEO_TIME_LIMIT_MINUTES * 60 * 1000;
const FINISHED_STATUSES: MediaTask['status'][] = ['succeeded', 'failed'];

export const MediaTaskErrorCodes = defineErrorCodes({
  INVOCATION_TASK_NOT_FOUND: 'warning',
  INVOCATION_TASK_TIMED_OUT: 'error',
});

/** 一個任務執行時要用的東西。 */
interface TaskRun {
  task: MediaTask;
  prepared: PreparedInvocation;
  input: MediaInput;
  log: InvocationLog;
}

// 任務編號 → 任務；完成或失敗的任務被取走後移除
const tasks = new Map<string, MediaTask>();
// Forge 位址 → 這個位址最後一個任務跑完的時間點；新任務接在後面排隊
const forgeQueues = new Map<string, Promise<void>>();

// ===== 送出 =====

/**
 * 送出一個生成任務，回傳排隊中的任務；之後用 getTask 查進度、取結果。
 * 準備階段的錯誤直接丟出（例如 MODEL_NOT_FOUND、INVOCATION_MODEL_TYPE_MISMATCH、INVOCATION_PARAM_INVALID），不建立任務；
 * 生成時的錯誤（供應商錯誤、INVOCATION_TASK_TIMED_OUT）放在任務的 error。
 */
export async function submitTask(request: MediaTaskRequest): Promise<MediaTask> {
  const log = startInvocationLog(request.callerModule, '生成任務', request.modelId);
  let prepared: PreparedInvocation;
  try {
    prepared = await prepareInvocation(request.modelId, request.params, 'media', SUBMIT_INTERFACE);
    log.setTarget(prepared);
    requireMediaConnector(prepared, SUBMIT_INTERFACE);
  } catch (error) {
    throw log.fail(error, SUBMIT_INTERFACE);
  }
  const task: MediaTask = { id: randomUUID(), modelId: request.modelId, status: 'queued' };
  tasks.set(task.id, task);
  // 先留下送出當下的樣子：雲端任務排進去後會立刻開始，回傳的一律是「排隊中」
  const submitted = { ...task };
  scheduleTask({ task, prepared, input: request.input, log });
  return submitted;
}

// ===== 查詢 =====

/**
 * 查詢任務的狀態、進度與結果；完成或失敗的任務只能取一次，取走後就移除。
 * 找不到時丟出 INVOCATION_TASK_NOT_FOUND（已經取走過、或平台重新啟動過）。
 */
export function getTask(id: string): MediaTask {
  // 查進度是單純讀取記憶體：只在失敗時寫 log（conventions.md 第 9 段）
  return logFailure(MODULE_NAME, '查詢生成任務', () => takeTask(id));
}

function takeTask(id: string): MediaTask {
  const task = tasks.get(id);
  if (!task) {
    throw createError(
      MODULE_NAME,
      'getTask',
      MediaTaskErrorCodes.INVOCATION_TASK_NOT_FOUND,
      `找不到編號為 ${id} 的生成任務，可能已經取走結果，或平台重新啟動過`,
      { taskId: id },
    );
  }
  if (FINISHED_STATUSES.includes(task.status)) tasks.delete(id);
  return { ...task };
}

// ===== 排隊 =====

/** 雲端供應商直接開始；Forge 同一個位址一次只跑一個，接在前一個後面。 */
function scheduleTask(run: TaskRun): void {
  const { model, connection } = run.prepared;
  if (model.provider !== FORGE_PROVIDER || !connection.address) {
    void runTask(run);
    return;
  }
  const address = connection.address;
  const previous = forgeQueues.get(address) ?? Promise.resolve();
  const current = previous.then(() => runTask(run));
  forgeQueues.set(address, current);
  void current.then(() => {
    if (forgeQueues.get(address) === current) forgeQueues.delete(address);
  });
}

// ===== 執行 =====

/** 執行一個任務到結束；所有錯誤都放進任務，不往外丟（排隊的下一個任務才能接著跑）。 */
async function runTask(run: TaskRun): Promise<void> {
  const { task, prepared, input, log } = run;
  const type = prepared.model.type as MediaModelType;
  const controller = new AbortController();
  // spec：影片超過 30 分鐘還沒完成，視為失敗
  const timer = type === 'video' ? setTimeout(() => controller.abort(), VIDEO_TIME_LIMIT_MS) : null;
  task.status = 'running';
  try {
    const result = await requireMediaConnector(prepared, SUBMIT_INTERFACE).generateMedia({
      type,
      model: prepared.model.modelId,
      connection: prepared.connection.connection,
      input,
      params: prepared.params,
      signal: controller.signal,
      onProgress: (progress) => updateProgress(task, progress),
    });
    task.cost = log.succeed(prepared, result.usage);
    task.result = result;
    finishTask(task, 'succeeded');
  } catch (error) {
    const failure = controller.signal.aborted ? timedOutError() : error;
    task.error = toPlainError(log.fail(failure, SUBMIT_INTERFACE));
    finishTask(task, 'failed');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 供應商回報的進度；有百分比時顯示進度條，沒有時顯示排隊中、處理中（spec 規則）。 */
function updateProgress(task: MediaTask, progress: MediaProgress): void {
  if (FINISHED_STATUSES.includes(task.status)) return;
  task.status = progress.status;
  if (progress.percent === undefined) delete task.percent;
  else task.percent = progress.percent;
}

function finishTask(task: MediaTask, status: 'succeeded' | 'failed'): void {
  task.status = status;
  delete task.percent;
}

function timedOutError() {
  return createError(
    MODULE_NAME,
    SUBMIT_INTERFACE,
    MediaTaskErrorCodes.INVOCATION_TASK_TIMED_OUT,
    `影片超過 ${VIDEO_TIME_LIMIT_MINUTES} 分鐘還沒完成，視為失敗`,
    { timeLimitMinutes: VIDEO_TIME_LIMIT_MINUTES },
  );
}
