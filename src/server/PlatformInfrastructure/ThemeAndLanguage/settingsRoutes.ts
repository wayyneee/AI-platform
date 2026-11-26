// 平台設定的 HTTP 路由：查詢設定、儲存設定、列出可選的主題與語言；每件事結束時依 log 原則寫一筆。

import type { FastifyInstance } from 'fastify';

import type {
  PlatformSettings,
  SettingOptions,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { logFailure, logOutcome } from '../SystemLog/index.ts';
import { getSettings, listSettingOptions, updateSettings } from './settingsStore.ts';

const MODULE_NAME = 'PlatformInfrastructure';

const updateSettingsBodySchema = {
  type: 'object',
  required: ['theme', 'language'],
  additionalProperties: false,
  properties: {
    theme: { type: 'string', minLength: 1 },
    language: { type: 'string', minLength: 1 },
  },
};

/** 登記設定的路由：`getSettings`、`updateSettings`、`listSettingOptions`。 */
export async function registerSettingsRoutes(server: FastifyInstance): Promise<void> {
  // 單純讀取本機資料：只在失敗時寫 log
  server.get('/getSettings', async (): Promise<{ settings: PlatformSettings }> => ({
    settings: logFailure(MODULE_NAME, '讀取平台設定', getSettings),
  }));

  server.get('/listSettingOptions', async (): Promise<{ options: SettingOptions }> => ({
    options: logFailure(MODULE_NAME, '列出可選的主題與語言', () => listSettingOptions()),
  }));

  // 會改變資料：成功和失敗都寫
  server.post<{ Body: PlatformSettings }>(
    '/updateSettings',
    { schema: { body: updateSettingsBodySchema } },
    async (request): Promise<{ settings: PlatformSettings }> => {
      const { theme, language } = request.body;
      const action = `儲存基礎設定（主題 ${theme}、語言 ${language}）`;
      return {
        settings: logOutcome(MODULE_NAME, action, () => updateSettings({ theme, language })),
      };
    },
  );
}
