// 平台設定的儲存與查詢：主題、語言存在本模組的資料庫；可選的主題是 public/theme/ 底下含有 theme.css 的資料夾。

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_LANGUAGE,
  DEFAULT_THEME,
  SUPPORTED_LANGUAGES,
  type PlatformSettings,
  type SettingOptions,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { openDatabase, type ModuleDatabase } from '../PlatformBootstrap/index.ts';
import { createError, defineErrorCodes } from '../SystemLog/index.ts';

const MODULE_NAME = 'PlatformInfrastructure';
const DATABASE_FILE = 'platform-infrastructure.db';
const SCHEMA_NAME = 'ThemeAndLanguage';
// 這個檔案在 src/server/PlatformInfrastructure/ThemeAndLanguage/，往上四層是專案根目錄
const DEFAULT_THEME_ROOT = path.resolve(import.meta.dirname, '../../../../public/theme');
const THEME_STYLE_FILE = 'theme.css';

export const SettingsErrorCodes = defineErrorCodes({
  SETTINGS_THEME_NOT_FOUND: 'warning',
  SETTINGS_LANGUAGE_NOT_FOUND: 'warning',
});

// 已發布的版本不可修改，只能往後新增（conventions.md 第 9 段）
const MIGRATIONS = [
  `CREATE TABLE platform_settings (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

type SettingName = keyof PlatformSettings;

// ===== 查詢 =====

/** 查詢主題、語言；沒有設定過的項目用預設值（default、zh-TW）。資料庫開不起來時丟出 DATABASE_ 開頭的錯誤。 */
export function getSettings(): PlatformSettings {
  const rows = openSettingsDatabase().all<{ name: string; value: string }>(
    'SELECT name, value FROM platform_settings',
  );
  const saved = new Map(rows.map((row) => [row.name, row.value]));
  return {
    theme: saved.get('theme') ?? DEFAULT_THEME,
    language: saved.get('language') ?? DEFAULT_LANGUAGE,
  };
}

/** 列出可以選的主題與語言；主題只列出含有 theme.css 的資料夾。 */
export function listSettingOptions(themeRoot: string = DEFAULT_THEME_ROOT): SettingOptions {
  return { themes: listThemes(themeRoot), languages: [...SUPPORTED_LANGUAGES] };
}

// ===== 儲存 =====

/**
 * 儲存主題與語言，回傳儲存後的設定。
 * 主題或語言不存在時丟出 SETTINGS_THEME_NOT_FOUND／SETTINGS_LANGUAGE_NOT_FOUND，資料不被修改。
 */
export function updateSettings(
  settings: PlatformSettings,
  themeRoot: string = DEFAULT_THEME_ROOT,
): PlatformSettings {
  // 兩項都先檢查完才寫入：任何一項不對，資料都不動
  checkThemeExists(settings.theme, themeRoot);
  checkLanguageSupported(settings.language);

  const database = openSettingsDatabase();
  const updatedAt = new Date().toISOString();
  database.transaction(() => {
    saveSetting(database, 'theme', settings.theme, updatedAt);
    saveSetting(database, 'language', settings.language, updatedAt);
  });
  return getSettings();
}

// ===== 檢查 =====

function checkThemeExists(theme: string, themeRoot: string): void {
  if (listThemes(themeRoot).includes(theme)) return;
  throw createError(
    MODULE_NAME,
    'updateSettings',
    SettingsErrorCodes.SETTINGS_THEME_NOT_FOUND,
    `找不到主題「${theme}」：${themeRoot} 底下沒有含 ${THEME_STYLE_FILE} 的同名資料夾`,
    { theme },
  );
}

function checkLanguageSupported(language: string): void {
  if (SUPPORTED_LANGUAGES.includes(language)) return;
  throw createError(
    MODULE_NAME,
    'updateSettings',
    SettingsErrorCodes.SETTINGS_LANGUAGE_NOT_FOUND,
    `平台沒有語言「${language}」的文字表`,
    { language, supportedLanguages: SUPPORTED_LANGUAGES },
  );
}

// ===== 輔助 =====

/** 第一次使用時才開啟並升級資料庫（spec 重要決定）；之後重複使用同一個連線。 */
function openSettingsDatabase(): ModuleDatabase {
  return openDatabase({
    module: MODULE_NAME,
    fileName: DATABASE_FILE,
    schemaName: SCHEMA_NAME,
    migrations: MIGRATIONS,
  });
}

function saveSetting(
  database: ModuleDatabase,
  name: SettingName,
  value: string,
  updatedAt: string,
): void {
  database.run(
    `INSERT INTO platform_settings (name, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [name, value, updatedAt],
  );
}

/** 主題資料夾裡一定要有 theme.css 才算一個主題；資料夾不存在時當作沒有主題。 */
function listThemes(themeRoot: string): string[] {
  if (!existsSync(themeRoot)) return [];
  return readdirSync(themeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(themeRoot, name, THEME_STYLE_FILE)))
    .sort();
}
