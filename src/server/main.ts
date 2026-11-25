// 後端進入點：建立伺服器、登記各核心模組，不放功能。

import Fastify from 'fastify';

import {
  handleUnexpectedError,
  initializePlatform,
  registerRoutes as registerPlatformInfrastructureRoutes,
} from './PlatformInfrastructure/index.ts';

// 只接受本機連線：平台在使用者自己的電腦上執行
const HOST = '127.0.0.1';
const PORT = 4317;

const server = Fastify();

// 錯誤攔截要在登記路由之前掛上，各模組的路由才會套用
handleUnexpectedError(server);
initializePlatform();

// ===== 登記各核心模組 =====
await server.register(registerPlatformInfrastructureRoutes, {
  prefix: '/api/PlatformInfrastructure',
});

await server.listen({ host: HOST, port: PORT });
