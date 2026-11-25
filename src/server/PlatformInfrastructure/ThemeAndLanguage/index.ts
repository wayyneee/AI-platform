// ThemeAndLanguage 後端的唯一入口：主題與語言設定的儲存與查詢、設定的路由。

export { getSettings, listSettingOptions, updateSettings } from './settingsStore.ts';
export { registerSettingsRoutes } from './settingsRoutes.ts';
