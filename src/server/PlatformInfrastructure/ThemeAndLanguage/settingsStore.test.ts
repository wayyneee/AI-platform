// 平台設定：預設值、儲存不存在的主題或語言、可選的主題只列出含 theme.css 的資料夾、設定的路由。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeAllDatabases } from '../PlatformBootstrap/index.ts';
import { handleUnexpectedError, isPlatformError, listLogs } from '../SystemLog/index.ts';
import { registerSettingsRoutes } from './settingsRoutes.ts';
import { getSettings, listSettingOptions, updateSettings } from './settingsStore.ts';

let dataDirectory: string;
let themeRoot: string;

beforeEach(() => {
  dataDirectory = mkdtempSync(path.join(tmpdir(), 'platform-settings-'));
  vi.stubEnv('PLATFORM_DATA_DIR', dataDirectory);
  themeRoot = path.join(dataDirectory, 'theme');
  createTheme('default');
  createTheme('sakura');
});

afterEach(() => {
  closeAllDatabases();
  vi.unstubAllEnvs();
  rmSync(dataDirectory, { recursive: true, force: true });
});

/** 在暫存的主題資料夾建立一個含 theme.css 的主題。 */
function createTheme(name: string): void {
  mkdirSync(path.join(themeRoot, name), { recursive: true });
  writeFileSync(path.join(themeRoot, name, 'theme.css'), ':root {}');
}

/** 執行並回傳丟出的錯誤；沒丟出錯誤時讓測試失敗。 */
function catchError(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  throw new Error('預期要丟出錯誤，但沒有');
}

describe('ThemeAndLanguage 設定', () => {
  it('沒有設定時，主題為 default、語言為繁體中文', () => {
    expect(getSettings()).toEqual({ theme: 'default', language: 'zh-TW' });
  });

  it('儲存存在的主題後查得到', () => {
    updateSettings({ theme: 'sakura', language: 'zh-TW' }, themeRoot);
    expect(getSettings()).toEqual({ theme: 'sakura', language: 'zh-TW' });
  });

  it('儲存不存在的主題或語言時回報錯誤，資料不被修改', () => {
    updateSettings({ theme: 'sakura', language: 'zh-TW' }, themeRoot);

    const themeError = catchError(() =>
      updateSettings({ theme: 'starry-night', language: 'zh-TW' }, themeRoot),
    );
    const languageError = catchError(() =>
      updateSettings({ theme: 'default', language: 'xx' }, themeRoot),
    );

    expect(isPlatformError(themeError) && themeError.code).toBe('SETTINGS_THEME_NOT_FOUND');
    expect(isPlatformError(languageError) && languageError.code).toBe(
      'SETTINGS_LANGUAGE_NOT_FOUND',
    );
    expect(getSettings()).toEqual({ theme: 'sakura', language: 'zh-TW' });
  });

  it('可選的主題只列出含有 theme.css 的主題資料夾', () => {
    mkdirSync(path.join(themeRoot, 'unfinished'), { recursive: true });
    writeFileSync(path.join(themeRoot, 'not-a-folder.css'), '');

    expect(listSettingOptions(themeRoot)).toEqual({
      themes: ['default', 'sakura'],
      languages: ['zh-TW'],
    });
  });
});

describe('ThemeAndLanguage 路由', () => {
  it('儲存基礎設定成功和失敗各寫一筆 log；失敗時回傳錯誤格式', async () => {
    const server = Fastify();
    handleUnexpectedError(server);
    await server.register(registerSettingsRoutes, { prefix: '/api/PlatformInfrastructure' });

    // 先開過資料庫：第一次開啟時的升級 log 是平台自己的事件，不算在這件事裡
    getSettings();
    // 正式的路由用 public/theme/，裡面一定有 default
    let countBefore = listLogs().length;
    const saved = await server.inject({
      method: 'POST',
      url: '/api/PlatformInfrastructure/updateSettings',
      payload: { theme: 'default', language: 'zh-TW' },
    });
    expect(saved.json()).toEqual({ settings: { theme: 'default', language: 'zh-TW' } });
    expect(listLogs().length - countBefore).toBe(1);
    expect(listLogs()[0].level).toBe('success');

    countBefore = listLogs().length;
    const failed = await server.inject({
      method: 'POST',
      url: '/api/PlatformInfrastructure/updateSettings',
      payload: { theme: 'no-such-theme', language: 'zh-TW' },
    });
    expect(failed.statusCode).toBe(400);
    expect(failed.json().error.code).toBe('SETTINGS_THEME_NOT_FOUND');
    expect(listLogs().length - countBefore).toBe(1);
    expect(listLogs()[0].level).toBe('warning');

    await server.close();
  });
});
