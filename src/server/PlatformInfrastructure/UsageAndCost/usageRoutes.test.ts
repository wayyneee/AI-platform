// 用量紀錄與花費統計的路由：Forge 不記錄、格數與當地時間分格、已刪除的 key、只能刪除已刪除 key 的紀錄、log。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  SavedModel,
  UsageStatsResult,
  UsageUnit,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { addApiKey, deleteApiKey } from '../ModelRegistry/index.ts';
import { closeAllDatabases } from '../PlatformBootstrap/index.ts';
import { handleUnexpectedError, listLogs } from '../SystemLog/index.ts';
import { recordUsage } from './usageRecords.ts';
import { registerUsageRoutes } from './usageRoutes.ts';

const API_PREFIX = '/api/PlatformInfrastructure';
// 固定「現在」：2026/11/26（週四）14:32，當地時間
const NOW = new Date(2026, 10, 26, 14, 32);

const LLM: SavedModel = {
  id: 'm1',
  type: 'llm',
  provider: 'openrouter',
  modelId: 'deepseek/deepseek-chat-v3',
  displayName: 'DeepSeek V3',
  keyId: null,
  address: null,
  price: { inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
  capabilities: null,
  params: [],
};
const FORGE: SavedModel = {
  ...LLM,
  id: 'm2',
  type: 'image',
  provider: 'forge',
  displayName: 'Forge',
  address: 'http://127.0.0.1:7860',
  price: {},
};
const ONE_MILLION_TOKENS = { inputTokens: 1_000_000, outputTokens: 0, searchCount: 0 };

let dataDirectory: string;
let server: FastifyInstance;

beforeEach(async () => {
  dataDirectory = mkdtempSync(path.join(tmpdir(), 'platform-usage-routes-'));
  vi.stubEnv('PLATFORM_DATA_DIR', dataDirectory);
  // 只換掉時間，Fastify 的計時器照常
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  server = Fastify();
  handleUnexpectedError(server);
  await server.register(registerUsageRoutes, { prefix: API_PREFIX });
});

afterEach(async () => {
  await server.close();
  closeAllDatabases();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(dataDirectory, { recursive: true, force: true });
});

// ===== 輔助 =====

function addKey(name: string) {
  return addApiKey({ provider: 'openrouter', name, keyValue: `sk-or-v1-${name}-0123456789` });
}

/** 在某個時間點記一筆用量。 */
function recordAt(time: Date, keyId: string, keyName: string, model: SavedModel = LLM) {
  vi.setSystemTime(time);
  const cost = recordUsage({ model, keyId, keyName, usage: ONE_MILLION_TOKENS });
  vi.setSystemTime(NOW);
  return cost;
}

async function getStats(unit: UsageUnit, keyId?: string) {
  const query = new URLSearchParams({ unit, ...(keyId ? { keyId } : {}) });
  const response = await server.inject({
    method: 'GET',
    url: `${API_PREFIX}/getUsageStats?${query.toString()}`,
  });
  return { status: response.statusCode, json: response.json() as UsageStatsResult };
}

async function deleteRecords(keyId: string) {
  const response = await server.inject({
    method: 'POST',
    url: `${API_PREFIX}/deleteUsage`,
    payload: { keyId },
  });
  return { status: response.statusCode, json: response.json() };
}

async function logsDuring(work: () => Promise<unknown>) {
  const countBefore = listLogs().length;
  await work();
  const all = listLogs();
  return all.slice(0, all.length - countBefore).reverse();
}

// ===== 記錄 =====

describe('花費計算正確；沒填價格只統計用量；Forge 不記錄用量', () => {
  it('記錄時依當下的模型價格算出花費，統計查得到', async () => {
    const key = addKey('個人');
    const cost = recordAt(NOW, key.id, key.name);
    expect(cost?.costUsd).toBeCloseTo(1);

    const { json } = await getStats('day');
    expect(json.stats?.totals).toMatchObject({ inputTokens: 1_000_000, hasPricedUsage: true });
    expect(json.stats?.totals.costUsd).toBeCloseTo(1);
  });

  it('之後改模型價格，不影響舊紀錄的花費', async () => {
    const key = addKey('個人');
    recordAt(NOW, key.id, key.name);
    const raised = { ...LLM, price: { inputPerMillionTokens: 10, outputPerMillionTokens: 20 } };
    recordAt(NOW, key.id, key.name, raised);

    const { json } = await getStats('day');
    expect(json.stats?.totals.costUsd).toBeCloseTo(1 + 10);
  });

  it('本地 Forge 不記錄用量', async () => {
    const key = addKey('個人');
    expect(
      recordUsage({
        model: FORGE,
        keyId: null,
        usage: { imageCount: 4, videoSeconds: 0, characterCount: 0 },
      }),
    ).toBeNull();
    const { json } = await getStats('day', key.id);
    expect(json.stats?.totals.imageCount).toBe(0);
  });

  it('雲端模型沒有 key 時記錄失敗並回報 USAGE_KEY_REQUIRED', () => {
    expect(() => recordUsage({ model: LLM, keyId: null, usage: ONE_MILLION_TOKENS })).toThrow(
      expect.objectContaining({ code: 'USAGE_KEY_REQUIRED' }),
    );
  });
});

// ===== 統計 =====

describe('統計的格數為 24、30、12、12，已刪除的 key 標示「已刪除」；只能刪除已刪除 key 的用量紀錄', () => {
  it('每小時、每天、每週、每月的格數為 24、30、12、12，沒有用量的格子也有', async () => {
    const key = addKey('個人');
    const counts: Record<UsageUnit, number> = { hour: 0, day: 0, week: 0, month: 0 };
    for (const unit of Object.keys(counts) as UsageUnit[]) {
      const { json } = await getStats(unit, key.id);
      counts[unit] = json.stats!.slots.length;
      expect(json.stats!.slots.every((slot) => slot.costUsd === 0)).toBe(true);
    }
    expect(counts).toEqual({ hour: 24, day: 30, week: 12, month: 12 });
  });

  it('依電腦的當地時間分格：最後一格是現在所在的那一格，每週從週一開始', async () => {
    const key = addKey('個人');
    const { json: hour } = await getStats('hour', key.id);
    const { json: week } = await getStats('week', key.id);
    const { json: month } = await getStats('month', key.id);
    expect(new Date(hour.stats!.slots.at(-1)!.start)).toEqual(new Date(2026, 10, 26, 14));
    expect(new Date(hour.stats!.slots[0].start)).toEqual(new Date(2026, 10, 25, 15));
    // 2026/11/26 是週四，這一週從 11/23（週一）開始
    expect(new Date(week.stats!.slots.at(-1)!.start)).toEqual(new Date(2026, 10, 23));
    expect(new Date(month.stats!.slots[0].start)).toEqual(new Date(2025, 11, 1));
  });

  it('用量落在它所在的格子；超出範圍的不算進來', async () => {
    const key = addKey('個人');
    recordAt(new Date(2026, 10, 26, 0, 5), key.id, key.name);
    recordAt(new Date(2026, 10, 25, 23, 59), key.id, key.name);
    recordAt(new Date(2026, 9, 27, 23, 0), key.id, key.name);

    const { json } = await getStats('day', key.id);
    const slots = json.stats!.slots;
    expect(slots.at(-1)!.inputTokens).toBe(1_000_000);
    expect(slots.at(-2)!.inputTokens).toBe(1_000_000);
    // 30 天前（10/27）已不在最近 30 天內
    expect(json.stats!.totals.inputTokens).toBe(2_000_000);
  });

  it('沒有指定 key 時選第一組；沒有任何 key 時沒有統計', async () => {
    expect((await getStats('day')).json).toEqual({ keys: [], stats: null });
    const first = addKey('個人');
    addKey('測試用');
    const { json } = await getStats('day');
    expect(json.stats?.keyId).toBe(first.id);
    expect(json.keys.map((key) => key.name)).toEqual(['個人', '測試用']);
  });

  it('已刪除但還有紀錄的 key 排在現有的 key 後面，標示已刪除並用當時的名稱', async () => {
    const kept = addKey('個人');
    const removed = addKey('舊帳號');
    recordAt(NOW, removed.id, removed.name);
    deleteApiKey(removed.id);

    const { json } = await getStats('day');
    expect(json.keys).toEqual([
      { id: kept.id, provider: 'openrouter', name: '個人', isDeleted: false },
      { id: removed.id, provider: 'openrouter', name: '舊帳號', isDeleted: true },
    ]);
    const { json: removedStats } = await getStats('day', removed.id);
    expect(removedStats.stats?.totals.inputTokens).toBe(1_000_000);
  });

  it('已刪除的 key 可以刪除紀錄，刪除後從選單消失', async () => {
    const removed = addKey('舊帳號');
    recordAt(NOW, removed.id, removed.name);
    deleteApiKey(removed.id);

    const { status, json } = await deleteRecords(removed.id);
    expect(status).toBe(200);
    expect(json).toEqual({ deletedCount: 1 });
    expect((await getStats('day')).json.keys).toEqual([]);
  });

  it('現有的 key 不能刪除紀錄，回報 USAGE_KEY_NOT_DELETED 且紀錄還在', async () => {
    const key = addKey('個人');
    recordAt(NOW, key.id, key.name);

    const { status, json } = await deleteRecords(key.id);
    expect(status).toBe(400);
    expect(json.error.code).toBe('USAGE_KEY_NOT_DELETED');
    expect((await getStats('day', key.id)).json.stats?.totals.inputTokens).toBe(1_000_000);
  });

  it('查詢不存在的 key 時回報 USAGE_KEY_NOT_FOUND；時間單位不對時回報格式錯誤', async () => {
    addKey('個人');
    expect((await getStats('day', 'missing')).json).toMatchObject({
      error: { code: 'USAGE_KEY_NOT_FOUND' },
    });
    expect((await getStats('year' as UsageUnit)).json).toMatchObject({
      error: { code: 'PLATFORM_REQUEST_INVALID' },
    });
  });
});

// ===== log =====

describe('log', () => {
  it('查詢統計成功不寫 log；刪除紀錄成功、失敗各一筆，記下 key 名稱', async () => {
    const removed = addKey('舊帳號');
    recordAt(NOW, removed.id, removed.name);
    deleteApiKey(removed.id);

    expect(await logsDuring(() => getStats('day'))).toEqual([]);
    const deleted = await logsDuring(() => deleteRecords(removed.id));
    expect(deleted).toMatchObject([
      { level: 'success', action: '刪除用量紀錄：舊帳號（OpenRouter）', keyName: '舊帳號' },
    ]);
    const failed = await logsDuring(() => deleteRecords(removed.id));
    expect(failed).toMatchObject([{ level: 'warning', error: { code: 'USAGE_KEY_NOT_FOUND' } }]);
  });
});
