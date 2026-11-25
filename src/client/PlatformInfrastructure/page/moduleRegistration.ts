// 「平台設定」的登記資訊：navbar 放最右邊，子頁面依序為基礎設定、API 串接、花費統計。

import './page.css';

import type { ModuleRegistration } from '../AppShell/index.ts';
import { BasicSettings } from './BasicSettings.tsx';
import { ApiSettingsComingSoon, UsageStatsComingSoon } from './ComingSoonPage.tsx';

/** 提供「平台設定」的登記資訊；由前端進入點交給 registerModule 登記進外殼。 */
export function getModuleRegistration(): ModuleRegistration {
  return {
    module: 'PlatformInfrastructure',
    // page.md：網址為 #/settings/basic、#/settings/api、#/settings/usage
    path: 'settings',
    labelKey: 'PlatformInfrastructure.nav.settings',
    eyebrowKey: 'PlatformInfrastructure.nav.settingsEyebrow',
    position: 'right',
    pages: [
      {
        path: 'basic',
        labelKey: 'PlatformInfrastructure.nav.basicSettings',
        component: BasicSettings,
      },
      {
        path: 'api',
        labelKey: 'PlatformInfrastructure.nav.apiSettings',
        component: ApiSettingsComingSoon,
      },
      {
        path: 'usage',
        labelKey: 'PlatformInfrastructure.nav.usageStats',
        component: UsageStatsComingSoon,
      },
    ],
  };
}
