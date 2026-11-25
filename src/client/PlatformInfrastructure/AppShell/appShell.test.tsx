// @vitest-environment jsdom
// 外殼：網址與換頁、未儲存離開確認、側邊欄、內容區的錯誤畫面、前端錯誤攔截、log 列的顯示與篩選。

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LogEntry } from '../../../shared/PlatformInfrastructure/types.ts';
import { closeAllModals, showModal, type ModalControls } from '../SharedComponents/index.ts';
import { AppShell } from './AppShell.tsx';
import { reportFrontendError } from './globalErrorHandling.ts';
import { useLeaveGuard } from './leaveGuard.ts';
import { formatDuration, formatLogTime, MAX_LOG_ENTRIES, mergeLogEntries } from './logFormat.ts';
import { registerModule } from './moduleRegistry.ts';

// ===== 測試用的模組與後端 =====

let shouldPageCrash = false;

function CrashingPage() {
  if (shouldPageCrash) throw new Error('畫面壞掉了');
  return <p>正常的頁面</p>;
}

/** 視窗內容：一打開就算有未儲存的修改，像填了一半的新增模型視窗。 */
function UnsavedModalContent({ controls }: { controls: ModalControls }) {
  useEffect(() => controls.setHasUnsavedChanges(true), [controls]);
  return <p>填了一半的視窗</p>;
}

/** 可以製造未儲存修改的頁面。 */
function EditorPage() {
  const [isDirty, setIsDirty] = useState(false);
  useLeaveGuard(isDirty);
  return (
    <>
      <p>編輯頁</p>
      <button onClick={() => setIsDirty(true)}>修改</button>
      <button onClick={() => setIsDirty(false)}>改回原樣</button>
      <button
        onClick={() =>
          showModal({
            title: '新增模型',
            content: (controls) => <UnsavedModalContent controls={controls} />,
          })
        }
      >
        開有修改的視窗
      </button>
      <button onClick={() => showModal({ title: '說明', content: <p>沒有修改的視窗</p> })}>
        開沒有修改的視窗
      </button>
    </>
  );
}

beforeAll(() => {
  registerModule({
    module: 'TestEditor',
    path: 'editor',
    labelKey: 'TestEditor.nav',
    position: 'right',
    pages: [
      { path: 'form', labelKey: 'TestEditor.form', component: EditorPage },
      { path: 'other', labelKey: 'TestEditor.other', component: () => <p>另一頁</p> },
    ],
  });
  registerModule({
    module: 'TestChat',
    path: 'chat',
    labelKey: 'TestChat.nav',
    position: 'left',
    pages: [{ path: 'room', labelKey: 'TestChat.room', component: () => <p>聊天室頁面</p> }],
  });
  registerModule({
    module: 'TestSettings',
    path: 'settings',
    labelKey: 'TestSettings.nav',
    position: 'right',
    pages: [
      { path: 'first', labelKey: 'TestSettings.first', component: CrashingPage },
      { path: 'second', labelKey: 'TestSettings.second', component: () => <p>第二頁</p> },
    ],
  });
});

/** 假的 SSE 連線：測試可以推送新的 log。 */
class FakeEventSource {
  static latest: FakeEventSource | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor() {
    FakeEventSource.latest = this;
    queueMicrotask(() => this.onopen?.());
  }
  push(entry: LogEntry): void {
    this.onmessage?.({ data: JSON.stringify(entry) });
  }
  close(): void {}
}

let backendLogs: LogEntry[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  shouldPageCrash = false;
  backendLogs = [];
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/listLogs')) return Response.json({ logs: backendLogs });
    return Response.json({ isWritten: true });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeEventSource);
  window.location.hash = '';
});

afterEach(() => {
  act(() => closeAllModals());
  cleanup();
  vi.unstubAllGlobals();
});

afterAll(() => {
  window.location.hash = '';
});

function makeLog(fields: Partial<LogEntry> & Pick<LogEntry, 'id' | 'time'>): LogEntry {
  return { level: 'success', module: 'TestChat', action: '做了一件事', ...fields };
}

/** 換網址並等外殼重新畫面。 */
async function goTo(path: string): Promise<void> {
  await act(async () => {
    window.location.hash = path;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

// ===== 網址與換頁 =====

describe('AppShell 網址與換頁', () => {
  it('不存在的網址導回首頁（第一個功能模組的第一個子頁面）', async () => {
    window.location.hash = '#/no-such/page';
    render(<AppShell />);
    await waitFor(() => expect(window.location.hash).toBe('#/chat/room'));
    expect(await screen.findByText('聊天室頁面')).toBeTruthy();
  });

  it('點 navbar 切換到模組的第一個子頁面，網址跟著改；子頁面 2 個以上才顯示側邊欄', async () => {
    await goTo('/chat/room');
    const { container } = render(<AppShell />);
    expect(container.querySelector('.platform-infrastructure-sidebar')).toBeNull();

    fireEvent.click(screen.getByText('TestSettings.nav'));
    await act(async () => window.dispatchEvent(new HashChangeEvent('hashchange')));

    expect(window.location.hash).toBe('#/settings/first');
    expect(container.querySelector('.platform-infrastructure-sidebar')).not.toBeNull();
    const navbar = container.querySelector<HTMLElement>('.platform-infrastructure-navbar')!;
    expect(within(navbar).getByText('TestSettings.nav').className).toContain('is-active');
  });

  it('頁面畫面出錯時，只有內容區顯示錯誤，navbar 和 log 列正常，切換頁面後恢復', async () => {
    shouldPageCrash = true;
    await goTo('/settings/first');
    const { container } = render(<AppShell />);

    expect(await screen.findByText('這個頁面發生錯誤')).toBeTruthy();
    expect(container.querySelector('.platform-infrastructure-navbar')).not.toBeNull();
    expect(container.querySelector('.platform-infrastructure-logbar')).not.toBeNull();
    const sentLog = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/writeLog'));
    expect(JSON.parse(sentLog?.[1].body).error.code).toBe('PLATFORM_PAGE_RENDER_FAILED');

    await goTo('/settings/second');
    expect(screen.getByText('第二頁')).toBeTruthy();
    expect(screen.queryByText('這個頁面發生錯誤')).toBeNull();
  });
});

// ===== 未儲存離開確認 =====

/** 模擬瀏覽器上一頁：網址先被瀏覽器改掉，接著才收到 hashchange。 */
async function pressBrowserBack(path: string): Promise<void> {
  await act(async () => {
    window.history.replaceState(null, '', `#${path}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

/** 打開編輯頁並做一個修改。 */
async function openEditorWithChanges(): Promise<HTMLElement> {
  await goTo('/editor/form');
  const { container } = render(<AppShell />);
  fireEvent.click(screen.getByText('修改'));
  return container;
}

describe('AppShell 未儲存離開確認', () => {
  it('有未儲存的修改時，點側邊欄先詢問；取消就留在原頁', async () => {
    const container = await openEditorWithChanges();
    const sidebar = container.querySelector<HTMLElement>('.platform-infrastructure-sidebar')!;
    await act(async () => fireEvent.click(within(sidebar).getByText('TestEditor.other')));

    expect(screen.getByRole('dialog').textContent).toContain('修改還沒儲存，確定不儲存並離開嗎？');
    expect(screen.getByRole('heading', { name: '尚未儲存' })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '取消' })));
    expect(window.location.hash).toBe('#/editor/form');
    expect(screen.getByText('編輯頁')).toBeTruthy();
  });

  it('有未儲存的修改時，點 navbar 先詢問；按「不儲存並離開」後換頁', async () => {
    await openEditorWithChanges();
    await act(async () => fireEvent.click(screen.getByText('TestChat.nav')));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: '不儲存並離開' })));
    await act(async () => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(window.location.hash).toBe('#/chat/room');
    expect(screen.getByText('聊天室頁面')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('改回原樣後不算未儲存的修改，換頁不詢問', async () => {
    await openEditorWithChanges();
    fireEvent.click(screen.getByText('改回原樣'));
    await act(async () => fireEvent.click(screen.getByText('TestChat.nav')));
    await act(async () => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('聊天室頁面')).toBeTruthy();
  });

  it('有未儲存的修改時按瀏覽器上一頁：網址改回原頁並詢問，確定後才到上一頁', async () => {
    await openEditorWithChanges();
    await pressBrowserBack('/chat/room');
    expect(window.location.hash).toBe('#/editor/form');
    expect(screen.getByText('編輯頁')).toBeTruthy();

    // 詢問中再按一次上一頁，不會跳出第二個確認視窗
    await pressBrowserBack('/chat/room');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    await act(async () => fireEvent.click(screen.getByRole('button', { name: '不儲存並離開' })));
    expect(window.location.hash).toBe('#/chat/room');
    expect(screen.getByText('聊天室頁面')).toBeTruthy();
  });

  it('有修改的視窗開著時按瀏覽器上一頁，確定離開後視窗一起關閉', async () => {
    await goTo('/editor/form');
    render(<AppShell />);
    fireEvent.click(screen.getByText('開有修改的視窗'));
    expect(screen.getByText('填了一半的視窗')).toBeTruthy();

    await pressBrowserBack('/chat/room');
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '不儲存並離開' })));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('聊天室頁面')).toBeTruthy();
  });

  it('換頁時外殼關閉所有視窗', async () => {
    await goTo('/editor/form');
    render(<AppShell />);
    fireEvent.click(screen.getByText('開沒有修改的視窗'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await pressBrowserBack('/chat/room');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('聊天室頁面')).toBeTruthy();
  });

  it('有未儲存的修改時，重新整理或關閉分頁會出現瀏覽器的離開提示；沒有修改時不會', async () => {
    await openEditorWithChanges();
    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByText('改回原樣'));
    const cleanUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
  });
});

// ===== 前端錯誤攔截 =====

describe('AppShell 前端錯誤攔截', () => {
  it('畫面中沒接住的錯誤寫進 log，並顯示錯誤訊息', async () => {
    await goTo('/chat/room');
    render(<AppShell />);
    act(() => reportFrontendError(new Error('按鈕的處理壞掉了')));

    expect(screen.getByRole('alert').textContent).toContain(
      '畫面發生未預期的錯誤，可以在 log 查看細節',
    );
    const sentLog = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/writeLog'));
    expect(JSON.parse(sentLog?.[1].body).error.message).toContain('按鈕的處理壞掉了');
  });
});

// ===== log 列 =====

describe('AppShell log 列', () => {
  it('沒有 log 時顯示「目前沒有 log」', async () => {
    await goTo('/chat/room');
    render(<AppShell />);
    expect(await screen.findByText('目前沒有 log')).toBeTruthy();
  });

  it('收合時只顯示最新一筆；新的 log 即時出現；展開後可以依等級篩選', async () => {
    backendLogs = [
      makeLog({ id: 'old', time: '2026-11-25T01:00:00.000Z', action: '較舊的事' }),
      makeLog({
        id: 'failed',
        time: '2026-11-25T02:00:00.000Z',
        level: 'error',
        action: '失敗的事',
        error: { module: 'TestChat', interfaceName: 'doThing', code: 'X_FAILED', message: 'm' },
      }),
    ];
    await goTo('/chat/room');
    const { container } = render(<AppShell />);
    const summary = container.querySelector('.platform-infrastructure-logbar-summary')!;
    await waitFor(() => expect(summary.textContent).toContain('失敗的事'));

    act(() =>
      FakeEventSource.latest?.push(makeLog({ id: 'new', time: '2026-11-25T03:00:00.000Z' })),
    );
    expect(summary.textContent).toContain('做了一件事');

    fireEvent.click(summary);
    const panel = container.querySelector<HTMLElement>('.platform-infrastructure-logbar-panel')!;
    fireEvent.click(within(panel).getByRole('tab', { name: '錯誤' }));
    const items = panel.querySelectorAll('.platform-infrastructure-log-entry');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('失敗的事');
    expect(items[0].textContent).toContain('TestChat／doThing（代碼：X_FAILED）');
  });
});

// ===== log 的整理與格式 =====

describe('AppShell log 的整理', () => {
  it('新的在前、同一筆不重複，最多保留最近 1000 筆', () => {
    const many = Array.from({ length: MAX_LOG_ENTRIES + 5 }, (_, index) =>
      makeLog({
        id: `log-${index}`,
        time: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      }),
    );
    const merged = mergeLogEntries(many.slice(0, 10), many);
    expect(merged).toHaveLength(MAX_LOG_ENTRIES);
    expect(merged[0].id).toBe(`log-${MAX_LOG_ENTRIES + 4}`);
  });

  it('時間顯示為當地時間的 MM-DD HH:mm:ss；耗時不到 1 秒顯示毫秒', () => {
    const localTime = new Date(2026, 10, 5, 9, 3, 7).toISOString();
    expect(formatLogTime(localTime)).toBe('11-05 09:03:07');
    expect(formatDuration(12)).toBe('12ms');
    expect(formatDuration(1234)).toBe('1.2s');
  });
});
