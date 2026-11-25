// @vitest-environment jsdom
// 前端的主題與語言：找不到文字、素材位址、主題載入失敗時改用 default。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getText, registerTextTable } from './textTable.ts';
import { applyTheme, getAssetUrl, isThemeStyleAvailable, setActiveTheme } from './themeLoader.ts';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // 寫 log 會送到後端：攔下請求，只記錄送了什麼
  fetchMock = vi.fn(async () => Response.json({ isWritten: true }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveTheme('default');
});

/** 送到後端的 log 內容。 */
function sentLogs(): { level: string; action: string; error?: { code: string } }[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith('/writeLog'))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

describe('ThemeAndLanguage 文字', () => {
  it('依目前語言取得文字，並換上參數', () => {
    registerTextTable('zh-TW', { 'TestModule.greeting': '你好，{name}' });
    expect(getText('TestModule.greeting', { name: '小藍' })).toBe('你好，小藍');
  });

  it('找不到文字時顯示文字鍵，同一個鍵只寫一筆警告', () => {
    expect(getText('TestModule.missing.first')).toBe('TestModule.missing.first');
    expect(getText('TestModule.missing.first')).toBe('TestModule.missing.first');
    getText('TestModule.missing.second');

    const warnings = sentLogs();
    expect(warnings).toHaveLength(2);
    expect(warnings.every((log) => log.level === 'warning')).toBe(true);
    expect(warnings[0].action).toContain('TestModule.missing.first');
  });
});

describe('ThemeAndLanguage 主題', () => {
  it('素材位址依目前主題組出', () => {
    setActiveTheme('sakura');
    expect(getAssetUrl('PlatformInfrastructure', 'platformLogo')).toBe(
      '/theme/sakura/PlatformInfrastructure/platformLogo.png',
    );
  });

  it('設定中的主題載入失敗時改用 default，並寫一筆警告', async () => {
    const loadStyle = vi.fn(async (theme: string) => theme === 'default');

    const applied = await applyTheme('starry-night', loadStyle);

    expect(applied).toBe('default');
    expect(loadStyle).toHaveBeenLastCalledWith('default');
    expect(getAssetUrl('PlatformInfrastructure', 'appBackground')).toBe(
      '/theme/default/PlatformInfrastructure/appBackground.png',
    );
    const [warning] = sentLogs();
    expect(warning.level).toBe('warning');
    expect(warning.error?.code).toBe('THEME_LOAD_FAILED');
  });

  it('主題資料夾不存在、伺服器回傳網頁或連不上時，判定為載入失敗', async () => {
    const htmlPage = new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
    const styleSheet = new Response(':root {}', { headers: { 'Content-Type': 'text/css' } });
    fetchMock.mockResolvedValueOnce(htmlPage).mockResolvedValueOnce(styleSheet);
    expect(await isThemeStyleAvailable('/theme/starry-night/theme.css')).toBe(false);
    expect(await isThemeStyleAvailable('/theme/default/theme.css')).toBe(true);

    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await isThemeStyleAvailable('/theme/missing/theme.css')).toBe(false);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await isThemeStyleAvailable('/theme/default/theme.css')).toBe(false);
  });

  it('主題載入成功時不寫 log', async () => {
    const applied = await applyTheme('sakura', async () => true);
    expect(applied).toBe('sakura');
    expect(sentLogs()).toHaveLength(0);
  });
});
