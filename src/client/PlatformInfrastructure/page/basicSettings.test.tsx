// @vitest-environment jsdom
// 基礎設定頁：帶入目前設定、未儲存的修改、儲存回饋、載入失敗、連不上後端。

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BasicSettings } from './BasicSettings.tsx';

type Route = (body: unknown) => Response | Promise<Response>;

let routes: Record<string, Route>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  routes = {
    getSettings: () => Response.json({ settings: { theme: 'default', language: 'zh-TW' } }),
    listSettingOptions: () =>
      Response.json({ options: { themes: ['default', 'sakura'], languages: ['zh-TW'] } }),
    updateSettings: (body) => Response.json({ settings: body }),
    writeLog: () => Response.json({ isWritten: true }),
  };
  // 依網址最後一段（介面名稱）分派到假的後端
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const interfaceName = url.split('?')[0].split('/').pop()!;
    return routes[interfaceName](init?.body ? JSON.parse(init.body as string) : undefined);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '儲存' });
}

/** 打開主題選單，選某個選項。 */
function chooseTheme(theme: string): void {
  fireEvent.click(screen.getByRole('button', { name: '主題' }));
  fireEvent.click(screen.getByRole('option', { name: theme }));
}

describe('BasicSettings', () => {
  it('進入時帶入目前的設定；主題、語言選單沒有「-- 請選擇 --」', async () => {
    render(<BasicSettings />);
    expect(screen.getByText('讀取中…')).toBeTruthy();

    expect((await screen.findByRole('button', { name: '主題' })).textContent).toBe('default');
    expect(screen.getByRole('button', { name: '語言' }).textContent).toBe('繁體中文');
    expect(screen.queryByText('-- 請選擇 --')).toBeNull();
  });

  it('沒有修改時儲存按鈕不能按；改選項後可以按，改回原樣後又不能按', async () => {
    render(<BasicSettings />);
    await screen.findByRole('button', { name: '主題' });
    expect(saveButton().disabled).toBe(true);

    chooseTheme('sakura');
    expect(saveButton().disabled).toBe(false);

    chooseTheme('default');
    expect(saveButton().disabled).toBe(true);
  });

  it('按儲存後顯示「已儲存，即將重新整理套用」，1.5 秒後重新整理', async () => {
    render(<BasicSettings />);
    await screen.findByRole('button', { name: '主題' });
    chooseTheme('sakura');

    vi.useFakeTimers();
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    await act(async () => fireEvent.click(saveButton()));

    expect(screen.getByText('已儲存，即將重新整理套用')).toBeTruthy();
    const sent = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/updateSettings'));
    expect(JSON.parse(sent?.[1].body)).toEqual({ theme: 'sakura', language: 'zh-TW' });

    act(() => vi.advanceTimersByTime(1499));
    expect(reload).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('儲存失敗時顯示紅色小字的錯誤說明，修改保留', async () => {
    routes.updateSettings = () =>
      Response.json(
        {
          error: {
            module: 'PlatformInfrastructure',
            interfaceName: 'updateSettings',
            code: 'SETTINGS_THEME_NOT_FOUND',
            message: '找不到主題',
          },
        },
        { status: 400 },
      );
    render(<BasicSettings />);
    await screen.findByRole('button', { name: '主題' });
    chooseTheme('sakura');
    await act(async () => fireEvent.click(saveButton()));

    const feedback = screen.getByText('找不到選擇的主題');
    expect(feedback.className).toContain('is-danger');
    expect(saveButton().disabled).toBe(false);
  });

  it('進入時查詢失敗：顯示「載入失敗」、錯誤訊息和「重試」，按重試後重新查詢', async () => {
    let isBackendDown = true;
    routes.getSettings = () => {
      if (isBackendDown) throw new TypeError('Failed to fetch');
      return Response.json({ settings: { theme: 'default', language: 'zh-TW' } });
    };
    render(<BasicSettings />);

    expect(await screen.findByText('載入失敗')).toBeTruthy();
    expect(screen.getByText('無法連線到平台，請確認平台是否還在執行')).toBeTruthy();
    expect(
      screen.getByText('PlatformInfrastructure／getSettings（代碼：PLATFORM_UNREACHABLE）'),
    ).toBeTruthy();

    isBackendDown = false;
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '主題' })).toBeTruthy());
  });
});
