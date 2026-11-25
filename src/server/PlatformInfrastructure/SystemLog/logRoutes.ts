// 系統 log 的 HTTP 路由：查詢 log、前端寫入 log、用 SSE 即時推送新的 log。

import type { FastifyInstance } from 'fastify';

import type { LogEntry, LogInput, LogLevel } from '../../../shared/PlatformInfrastructure/types.ts';
import { listLogs, subscribeLogs, writeLog } from './logStore.ts';

const LOG_LEVELS: LogLevel[] = ['success', 'warning', 'error'];

const platformErrorSchema = {
  type: 'object',
  required: ['module', 'interfaceName', 'code', 'message'],
  properties: {
    module: { type: 'string' },
    interfaceName: { type: 'string' },
    code: { type: 'string' },
    message: { type: 'string' },
    details: {},
  },
};

const writeLogBodySchema = {
  type: 'object',
  required: ['level', 'module', 'action'],
  additionalProperties: false,
  properties: {
    level: { type: 'string', enum: LOG_LEVELS },
    module: { type: 'string', minLength: 1 },
    action: { type: 'string', minLength: 1 },
    status: { type: 'string' },
    durationMs: { type: 'number', minimum: 0 },
    usage: { type: 'string' },
    keyName: { type: 'string' },
    error: platformErrorSchema,
  },
};

const listLogsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { level: { type: 'string', enum: LOG_LEVELS } },
};

/** 登記 log 的路由：`listLogs`、`writeLog`、`subscribeLogs`。 */
export async function registerLogRoutes(server: FastifyInstance): Promise<void> {
  server.get<{ Querystring: { level?: LogLevel } }>(
    '/listLogs',
    { schema: { querystring: listLogsQuerySchema } },
    async (request): Promise<{ logs: LogEntry[] }> => ({
      logs: listLogs({ level: request.query.level }),
    }),
  );

  server.post<{ Body: LogInput }>(
    '/writeLog',
    { schema: { body: writeLogBodySchema } },
    async (request): Promise<{ isWritten: true }> => {
      writeLog(request.body);
      return { isWritten: true };
    },
  );

  server.get('/subscribeLogs', (request, reply) => {
    // SSE 連線由這裡自己管理，不交給 Fastify 回應
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write(': connected\n\n');
    const unsubscribe = subscribeLogs((entry) => {
      reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`);
    });
    request.raw.on('close', unsubscribe);
  });
}
