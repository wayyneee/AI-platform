// 外殼的啟動：載入平台設定、套用語言與主題、掛上前端最外層錯誤攔截，再畫出外殼。

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import {
  DEFAULT_LANGUAGE,
  DEFAULT_THEME,
  type PlatformSettings,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { applyTheme, getSettings, getText, setActiveLanguage } from '../ThemeAndLanguage/index.ts';
import { AppShell } from './AppShell.tsx';
import { handleFrontendErrors } from './globalErrorHandling.ts';

// src/client/index.html 裡放外殼的元素
const ROOT_ELEMENT_ID = 'root';

/** 載入設定、套用主題並畫出外殼；由前端進入點在登記完模組後呼叫。 */
export async function startAppShell(): Promise<void> {
  handleFrontendErrors();
  const settings = await loadSettingsOrDefault();
  setActiveLanguage(settings.language);
  // 等主題的樣式載入完才畫，避免先閃一下沒有樣式的畫面
  await applyTheme(settings.theme);
  document.title = getText('PlatformInfrastructure.app.title');

  const container = document.getElementById(ROOT_ELEMENT_ID);
  if (!container) throw new Error(`找不到外殼的元素 #${ROOT_ELEMENT_ID}`);
  createRoot(container).render(
    <StrictMode>
      <AppShell />
    </StrictMode>,
  );
}

/**
 * 讀不到設定時（後端沒開、資料庫壞掉）用預設值，平台照常顯示。
 * 不另外寫 log：後端回傳的錯誤後端已寫過；連不上時 log 也送不出去。各頁面查詢時會再顯示錯誤。
 */
async function loadSettingsOrDefault(): Promise<PlatformSettings> {
  try {
    return await getSettings();
  } catch {
    return { theme: DEFAULT_THEME, language: DEFAULT_LANGUAGE };
  }
}
