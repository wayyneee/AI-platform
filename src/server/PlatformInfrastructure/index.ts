// PlatformInfrastructure 後端的唯一入口：其他核心模組和後端進入點只透過這裡使用平台基礎。

import type { FastifyInstance } from 'fastify';

import { registerApiKeyRoutes, registerModelRoutes } from './ModelRegistry/index.ts';
import { registerLogRoutes } from './SystemLog/index.ts';
import { registerSettingsRoutes } from './ThemeAndLanguage/index.ts';
import { registerUsageRoutes } from './UsageAndCost/index.ts';

export { initializePlatform, openDatabase, serveClientApp } from './PlatformBootstrap/index.ts';
export type { Migration, ModuleDatabase, OpenDatabaseOptions } from './PlatformBootstrap/index.ts';
export {
  createError,
  defineErrorCodes,
  handleUnexpectedError,
  isPlatformError,
  writeLog,
} from './SystemLog/index.ts';
export { getModelParams, listModels } from './ModelRegistry/index.ts';
export { getTask, invokeModel, streamModel, submitTask } from './ModelInvocation/index.ts';
export { getSettings } from './ThemeAndLanguage/index.ts';

/** 登記本模組所有 HTTP 路由；由後端進入點以 `/api/PlatformInfrastructure` 為前綴登記。 */
export async function registerRoutes(server: FastifyInstance): Promise<void> {
  await server.register(registerLogRoutes);
  await server.register(registerSettingsRoutes);
  await server.register(registerApiKeyRoutes);
  await server.register(registerModelRoutes);
  await server.register(registerUsageRoutes);
}
