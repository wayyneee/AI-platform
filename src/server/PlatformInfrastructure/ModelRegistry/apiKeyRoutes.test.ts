// API key 的路由：key 不出現在任何回應、log 與錯誤細節中；會改變資料的事成功、失敗各一筆 log，列出只在失敗時寫。

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeAllDatabases } from '../PlatformBootstrap/index.ts';
import { handleUnexpectedError, listLogs } from '../SystemLog/index.ts';
import { registerApiKeyRoutes } from './apiKeyRoutes.ts';

const SECRET_KEY = 'sk-or-v1-SECRET-0123456789';
const SECOND_SECRET_KEY = 'sk-or-v1-SECOND-9876543210';
const API_PREFIX = '/api/PlatformInfrastructure';

let dataDirectory: string;
let server: FastifyInstance;

beforeEach(async () => {
  dataDirectory = mkdtempSync(path.join(tmpdir(), 'platform-api-key-routes-'));
  vi.stubEnv('PLATFORM_DATA_DIR', dataDirectory);
  server = Fastify();
  handleUnexpectedError(server);
  await server.register(registerApiKeyRoutes, { prefix: API_PREFIX });
});

afterEach(async () => {
  await server.close();
  closeAllDatabases();
  vi.unstubAllEnvs();
  rmSync(dataDirectory, { recursive: true, force: true });
});

async function post(interfaceName: string, body: unknown) {
  const response = await server.inject({
    method: 'POST',
    url: `${API_PREFIX}/${interfaceName}`,
    payload: body as Record<string, unknown>,
  });
  return { status: response.statusCode, body: response.body, json: response.json() };
}

async function listKeys() {
  const response = await server.inject({ method: 'GET', url: `${API_PREFIX}/listApiKeys` });
  return { body: response.body, json: response.json() };
}

/** 這次測試寫的 log（log 是全平台共用的，用開始前的筆數區分）。 */
function logsSince(countBefore: number) {
  const all = listLogs();
  return all.slice(0, all.length - countBefore);
}

/** 資料夾裡所有檔案的文字內容（含 log 紀錄檔）。 */
function readAllDataFiles(directory: string): string {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
    .map((entry) => readFileSync(path.join(entry.parentPath, entry.name), 'utf8'))
    .join('\n');
}

describe('ModelRegistry API key 路由', () => {
  it('API key 不出現在任何回應、log 與錯誤細節中', async () => {
    const logCountBefore = listLogs().length;
    const responses: string[] = [];

    const added = await post('addApiKey', {
      provider: 'openrouter',
      name: '個人',
      keyValue: SECRET_KEY,
    });
    responses.push(added.body);
    const id = added.json.key.id as string;
    // 失敗的情況：同名、找不到、格式不對
    responses.push(
      (await post('addApiKey', { provider: 'openrouter', name: '個人', keyValue: SECRET_KEY }))
        .body,
    );
    responses.push(
      (await post('addApiKey', { provider: 'openrouter', keyValue: SECOND_SECRET_KEY })).body,
    );
    responses.push(
      (await post('updateApiKey', { id: 'missing', name: 'x', keyValue: SECOND_SECRET_KEY })).body,
    );
    responses.push(
      (await post('updateApiKey', { id, name: '主要', keyValue: SECOND_SECRET_KEY })).body,
    );
    responses.push((await listKeys()).body);
    responses.push((await post('deleteApiKey', { id })).body);

    const logText = JSON.stringify(logsSince(logCountBefore));
    const everything = [...responses, logText, readAllDataFiles(dataDirectory)].join('\n');
    expect(everything).not.toContain(SECRET_KEY);
    expect(everything).not.toContain(SECOND_SECRET_KEY);
    // log 有記 key 的名稱
    expect(logText).toContain('個人');
  });

  it('列出時回應只有遮罩值', async () => {
    await post('addApiKey', { provider: 'openrouter', name: '個人', keyValue: SECRET_KEY });
    const { json } = await listKeys();
    expect(json.keys).toEqual([
      { id: expect.any(String), provider: 'openrouter', name: '個人', maskedKey: 'sk-****6789' },
    ]);
  });

  it('新增、修改、刪除成功各一筆正確的 log，帶 key 名稱；列出成功不寫 log', async () => {
    // 先開過資料庫：第一次開啟時的「資料庫升級」log 不算在這次的操作裡
    await listKeys();
    const logCountBefore = listLogs().length;
    const added = await post('addApiKey', {
      provider: 'openrouter',
      name: '個人',
      keyValue: SECRET_KEY,
    });
    const id = added.json.key.id as string;
    await post('updateApiKey', { id, name: '主要', keyValue: SECOND_SECRET_KEY });
    await listKeys();
    await post('deleteApiKey', { id });

    const logs = logsSince(logCountBefore).reverse();
    expect(logs.map((log) => [log.level, log.action, log.keyName])).toEqual([
      ['success', '新增 API key：個人（OpenRouter）', '個人'],
      ['success', '修改 API key：個人（OpenRouter），名稱改為「主要」，換新 key', '主要'],
      ['success', '刪除 API key：主要（OpenRouter）', '主要'],
    ]);
  });

  it('同供應商同名時回報 API_KEY_NAME_TAKEN，剛好一筆警告 log', async () => {
    await post('addApiKey', { provider: 'grok', name: '個人', keyValue: SECRET_KEY });
    const logCountBefore = listLogs().length;

    const response = await post('addApiKey', {
      provider: 'grok',
      name: '個人',
      keyValue: SECOND_SECRET_KEY,
    });

    expect(response.status).toBe(400);
    expect(response.json.error).toMatchObject({
      module: 'PlatformInfrastructure',
      interfaceName: 'addApiKey',
      code: 'API_KEY_NAME_TAKEN',
    });
    const logs = logsSince(logCountBefore);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: 'warning', action: '新增 API key：個人（Grok）' });
  });
});
