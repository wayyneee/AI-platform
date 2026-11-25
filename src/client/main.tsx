// 前端進入點：登記各核心模組的頁面，再啟動外殼；不放功能。

import {
  getModuleRegistration as getPlatformInfrastructureRegistration,
  registerModule,
  startAppShell,
} from './PlatformInfrastructure/index.ts';

// ===== 登記各核心模組 =====
registerModule(getPlatformInfrastructureRegistration());

void startAppShell();
