// 用啟動檔執行時提供畫面：後端同時提供打包後的前端和 /api；還沒打包時直接報錯。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleUnexpectedError } from '../SystemLog/index.ts';
import { registerClientFiles } from './clientApp.ts';

const PAGE_MARKER = '<div id="root"></div>';
const SCRIPT_CONTENT = 'console.log("app");';
const OUTSIDE_CONTENT = 'content-outside-client-directory';

let clientDirectory: string;
let server: FastifyInstance;

beforeEach(() => {
  clientDirectory = mkdtempSync(path.join(tmpdir(), 'client-app-'));
  server = Fastify();
  handleUnexpectedError(server);
});

afterEach(async () => {
  await server.close();
  rmSync(clientDirectory, { recursive: true, force: true });
});

describe('PlatformBootstrap 提供畫面', () => {
  it('用啟動檔執行時，平台網址打得開畫面，`/api` 照常運作', async () => {
    writeBuiltClient();
    await server.register(registerExampleApi, { prefix: '/api/ExampleModule' });
    await registerClientFiles(server, clientDirectory);

    const page = await server.inject({ method: 'GET', url: '/' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain(PAGE_MARKER);

    const script = await server.inject({ method: 'GET', url: '/assets/app.js' });
    expect(script.statusCode).toBe(200);
    expect(script.body).toBe(SCRIPT_CONTENT);

    const api = await server.inject({ method: 'GET', url: '/api/ExampleModule/ping' });
    expect(api.json()).toEqual({ ok: true });

    // 不存在的介面仍回本專案的錯誤格式，不會被當成畫面檔案
    const missing = await server.inject({ method: 'GET', url: '/api/ExampleModule/missing' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toMatchObject({ code: 'PLATFORM_ROUTE_NOT_FOUND' });
  });

  it('畫面還沒打包就啟動時，直接報錯停止', async () => {
    await expect(registerClientFiles(server, clientDirectory)).rejects.toMatchObject({
      code: 'PLATFORM_CLIENT_NOT_BUILT',
    });
  });

  it('不能讀到畫面資料夾以外的檔案', async () => {
    // 暫存資料夾裡：built/ 是畫面資料夾，outside.txt 在它外面
    const builtDirectory = path.join(clientDirectory, 'built');
    mkdirSync(builtDirectory);
    writeBuiltClient(builtDirectory);
    writeFileSync(path.join(clientDirectory, 'outside.txt'), OUTSIDE_CONTENT);
    await registerClientFiles(server, builtDirectory);

    for (const url of ['/../outside.txt', '/..%2Foutside.txt', '/%2e%2e/outside.txt']) {
      const response = await server.inject({ method: 'GET', url });
      expect(response.statusCode).not.toBe(200);
      expect(response.body).not.toContain(OUTSIDE_CONTENT);
    }
  });
});

// ===== 輔助 =====

/** 在資料夾放一份像 vite build 產生的畫面；沒指定時放在暫存資料夾。 */
function writeBuiltClient(directory = clientDirectory): void {
  writeFileSync(path.join(directory, 'index.html'), `<html><body>${PAGE_MARKER}</body></html>`);
  mkdirSync(path.join(directory, 'assets'));
  writeFileSync(path.join(directory, 'assets', 'app.js'), SCRIPT_CONTENT);
}

async function registerExampleApi(api: FastifyInstance): Promise<void> {
  api.get('/ping', () => ({ ok: true }));
}
