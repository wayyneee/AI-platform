// 後端最外層錯誤攔截：錯誤只寫一筆 log、回應不含程式堆疊、未預期的錯誤不讓平台停止。

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleUnexpectedError, logUncaughtError } from './errorHandling.ts';
import { listLogs, writeLog } from './logStore.ts';
import { createError } from './platformError.ts';

let server: FastifyInstance;

beforeEach(async () => {
  server = Fastify();
  handleUnexpectedError(server);
  await server.register(
    async (module) => {
      module.get('/loggedFailure', async () => {
        // 發起這件事的地方已經寫過 log，再丟出同一個錯誤
        const error = createError('TestModule', 'loggedFailure', 'TEST_ALREADY_LOGGED', '已寫過');
        writeLog({ level: 'error', module: 'TestModule', action: '測試失敗', error });
        throw error;
      });
      module.get('/unloggedFailure', async () => {
        throw createError('TestModule', 'unloggedFailure', 'TEST_NOT_LOGGED', '還沒寫過');
      });
      module.get('/unexpectedFailure', async () => {
        throw new Error('意外的錯誤');
      });
      module.get('/healthy', async () => ({ isHealthy: true }));
    },
    { prefix: '/api/TestModule' },
  );
});

afterEach(async () => {
  await server.close();
});

/** 這次請求期間新增的 log。 */
function logsSince(countBefore: number) {
  return listLogs().slice(0, listLogs().length - countBefore);
}

describe('SystemLog 錯誤攔截', () => {
  it('後端回傳錯誤時，同一個錯誤只寫一筆 log；回應不含程式堆疊', async () => {
    for (const route of ['loggedFailure', 'unloggedFailure', 'unexpectedFailure']) {
      const countBefore = listLogs().length;
      const response = await server.inject({ method: 'GET', url: `/api/TestModule/${route}` });

      expect(logsSince(countBefore)).toHaveLength(1);
      expect(response.json()).toHaveProperty('error.code');
      expect(response.body).not.toContain('stack');
      expect(response.body).not.toContain('.ts:');
    }
  });

  it('後端發生未預期的錯誤時，寫進 log，平台不會停止', async () => {
    const countBefore = listLogs().length;
    const failed = await server.inject({ method: 'GET', url: '/api/TestModule/unexpectedFailure' });

    expect(failed.statusCode).toBe(500);
    expect(failed.json().error).toMatchObject({
      module: 'TestModule',
      interfaceName: 'unexpectedFailure',
      code: 'PLATFORM_UNEXPECTED_ERROR',
    });
    const [logged] = logsSince(countBefore);
    expect(logged).toMatchObject({ level: 'error', module: 'TestModule' });
    // log 裡留著程式堆疊方便除錯
    expect(JSON.stringify(logged.error?.details)).toContain('意外的錯誤');

    const healthy = await server.inject({ method: 'GET', url: '/api/TestModule/healthy' });
    expect(healthy.json()).toEqual({ isHealthy: true });

    // 程式中沒接住的錯誤也寫進 log，且 Node 不會因此結束（已掛上 uncaughtException）
    logUncaughtError(new Error('背景工作的錯誤'));
    expect(listLogs()[0]).toMatchObject({ level: 'error', action: '未預期的錯誤' });
    expect(process.listeners('uncaughtException')).toContain(logUncaughtError);
  });
});
