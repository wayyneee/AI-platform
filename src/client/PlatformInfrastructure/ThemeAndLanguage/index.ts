// ThemeAndLanguage 前端的唯一入口：平台設定的查詢與儲存、文字表、主題的套用與素材位址。

export { getSettings, listSettingOptions, updateSettings } from './settingsClient.ts';
export { getText, registerTextTable, setActiveLanguage } from './textTable.ts';
export type { TextParams } from './textTable.ts';
export { applyTheme, getAssetUrl } from './themeLoader.ts';
