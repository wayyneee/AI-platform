// @vitest-environment jsdom
// API 串接頁的 API key 分頁：列表與遮罩值、新增列與必填、依序新增修改與部分失敗、刪除確認、分頁切換詢問、連不上後端。

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiKeySummary } from '../../../shared/PlatformInfrastructure/types.ts';
import { closeAllModals, OverlayHost } from '../SharedComponents/index.ts';
import { ApiSettings } from './ApiSettings.tsx';

type Route = (body: Record<string, string>) => Response | Promise<Response>;

const OPENROUTER_KEY: ApiKeySummary = {
  id: 'k1',
  provider: 'openrouter',
  name: '個人',
  maskedKey: 'sk-****a3f9',
};
const CLAUDE_KEY: ApiKeySummary = {
  id: 'k2',
  provider: 'claude',
  name: '工作用',
  maskedKey: 'sk-****7bKd',
};

let savedKeys: ApiKeySummary[];
let routes: Record<string, Route>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  savedKeys = [OPENROUTER_KEY, CLAUDE_KEY];
  routes = {
    listApiKeys: () => Response.json({ keys: savedKeys }),
    listModels: () => Response.json({ models: [] }),
    addApiKey: (body) => {
      const key = {
        id: `k-${body.name}`,
        provider: body.provider,
        name: body.name,
        maskedKey: 'new****1234',
      };
      return Response.json({ key });
    },
    updateApiKey: (body) => {
      const existing = savedKeys.find((key) => key.id === body.id)!;
      return Response.json({ key: { ...existing, name: body.name } });
    },
    deleteApiKey: (body) => Response.json({ key: savedKeys.find((key) => key.id === body.id) }),
    writeLog: () => Response.json({ isWritten: true }),
  };
  // 依網址最後一段（介面名稱）分派到假的後端
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const interfaceName = url.split('?')[0].split('/').pop()!;
    return routes[interfaceName](init?.body ? JSON.parse(init.body as string) : {});
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  act(() => closeAllModals());
  cleanup();
  vi.unstubAllGlobals();
});

// ===== 輔助 =====

async function renderPage(): Promise<void> {
  render(
    <>
      <ApiSettings />
      <OverlayHost />
    </>,
  );
  await screen.findByRole('tab', { name: 'API key' });
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '儲存' });
}

function nameInputs(): HTMLInputElement[] {
  return screen.getAllByRole('textbox', { name: '名稱' }) as HTMLInputElement[];
}

function keyInputs(): HTMLInputElement[] {
  return screen.getAllByLabelText('key') as HTMLInputElement[];
}

function type(input: HTMLInputElement, value: string): void {
  fireEvent.change(input, { target: { value } });
}

/** 新增一列並選供應商。 */
function addRowWithProvider(providerLabel: string): void {
  fireEvent.click(screen.getByRole('button', { name: '＋ 新增 API key' }));
  fireEvent.click(screen.getByRole('button', { name: '供應商' }));
  fireEvent.click(screen.getByRole('option', { name: providerLabel }));
}

async function clickSave(): Promise<void> {
  await act(async () => fireEvent.click(saveButton()));
}

/** 送給後端某個介面的所有內容。 */
function sentBodies(interfaceName: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith(`/${interfaceName}`))
    .map(([, init]) => JSON.parse(init.body));
}

function errorResponse(interfaceName: string, code: string): Response {
  return Response.json(
    { error: { module: 'PlatformInfrastructure', interfaceName, code, message: code } },
    { status: 400 },
  );
}

// ===== 測試 =====

describe('ApiSettings：API key 分頁', () => {
  it('進入時列出已儲存的 key：供應商只顯示文字，key 欄位空白、提示文字是遮罩值', async () => {
    await renderPage();

    expect(screen.getByText('OpenRouter')).toBeTruthy();
    expect(screen.getByText('Claude')).toBeTruthy();
    expect(nameInputs().map((input) => input.value)).toEqual(['個人', '工作用']);
    expect(keyInputs().map((input) => input.value)).toEqual(['', '']);
    expect(keyInputs()[0].placeholder).toBe('sk-****a3f9（輸入新值代表換 key）');
    expect(keyInputs()[0].type).toBe('password');
    expect(saveButton().disabled).toBe(true);
  });

  it('沒有任何 key 時顯示空狀態「還沒有 API key」，按新增後出現新列', async () => {
    savedKeys = [];
    await renderPage();

    expect(screen.getByText('還沒有 API key')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增 API key' }));
    expect(screen.queryByText('還沒有 API key')).toBeNull();
    expect(nameInputs()).toHaveLength(1);
  });

  it('新增的列加在最上方；供應商選單只列需要 key 的供應商', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增 API key' }));

    expect(nameInputs().map((input) => input.value)).toEqual(['', '個人', '工作用']);
    fireEvent.click(screen.getByRole('button', { name: '供應商' }));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['-- 請選擇 --', 'OpenAI', 'Gemini', 'Claude', 'Grok', 'OpenRouter']);
  });

  it('新增 key 列名稱留空就儲存，該列紅框且沒有送出', async () => {
    await renderPage();
    addRowWithProvider('Grok');
    type(keyInputs()[0], 'xai-0123456789abcdef');
    await clickSave();

    expect(nameInputs()[0].getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('請填好紅框的欄位')).toBeTruthy();
    expect(screen.getByText('請先填好紅框的欄位')).toBeTruthy();
    expect(sentBodies('addApiKey')).toEqual([]);
  });

  it('填好儲存後顯示遮罩值，key 欄位清空，顯示「已儲存」', async () => {
    await renderPage();
    addRowWithProvider('Grok');
    type(nameInputs()[0], '個人');
    type(keyInputs()[0], 'xai-0123456789abcdef');
    await clickSave();

    expect(sentBodies('addApiKey')).toEqual([
      { provider: 'grok', name: '個人', keyValue: 'xai-0123456789abcdef' },
    ]);
    expect(keyInputs()[0].value).toBe('');
    expect(keyInputs()[0].placeholder).toBe('new****1234（輸入新值代表換 key）');
    expect(screen.getByText('Grok')).toBeTruthy();
    expect(screen.getByText('已儲存').className).toContain('is-success');
    expect(saveButton().disabled).toBe(true);
  });

  it('只改名稱時送出的內容不帶 key（key 不變）', async () => {
    await renderPage();
    type(nameInputs()[0], '主要');
    await clickSave();

    expect(sentBodies('updateApiKey')).toEqual([{ id: 'k1', name: '主要' }]);
  });

  it('依序先新增、再修改；成功的照存，失敗的列保留紅框和輸入內容，顯示「部分儲存失敗」', async () => {
    routes.updateApiKey = () => errorResponse('updateApiKey', 'API_KEY_NAME_TAKEN');
    await renderPage();
    type(nameInputs()[0], '工作用');
    addRowWithProvider('OpenAI');
    type(nameInputs()[0], '新的');
    type(keyInputs()[0], 'sk-proj-0123456789');
    await clickSave();

    const order = fetchMock.mock.calls.map(([url]) => String(url).split('/').pop());
    const sent = order.filter((name) => name !== 'listApiKeys' && name !== 'listModels');
    expect(sent).toEqual(['addApiKey', 'updateApiKey']);
    expect(screen.getByText('部分儲存失敗').className).toContain('is-danger');
    // 新增成功的列變成已儲存；改名失敗的列保留輸入內容並紅框
    expect(nameInputs().map((input) => input.value)).toEqual(['新的', '工作用', '工作用']);
    expect(nameInputs()[1].getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('同一家供應商已經有這個名稱的 key')).toBeTruthy();
    expect(saveButton().disabled).toBe(false);
  });

  it('刪除沒填好的列後，上一次儲存的結果小字跟著消失', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增 API key' }));
    await clickSave();
    expect(screen.getByText('請先填好紅框的欄位')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: '刪除' })[0]);
    expect(screen.queryByText('請先填好紅框的欄位')).toBeNull();
  });

  it('刪除新列直接移除，不跳確認', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增 API key' }));
    fireEvent.click(screen.getAllByRole('button', { name: '刪除' })[0]);

    expect(nameInputs()).toHaveLength(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('刪除已儲存的 key 先跳出危險確認，取消不刪；確認後刪除並提示', async () => {
    await renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: '刪除' })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('確定要刪除「個人」（OpenRouter）嗎？');
    expect(document.activeElement?.textContent).toBe('取消');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sentBodies('deleteApiKey')).toEqual([]);

    fireEvent.click(screen.getAllByRole('button', { name: '刪除' })[0]);
    const secondDialog = await screen.findByRole('dialog');
    await act(async () =>
      fireEvent.click(within(secondDialog).getByRole('button', { name: '刪除' })),
    );

    expect(sentBodies('deleteApiKey')).toEqual([{ id: 'k1' }]);
    expect(nameInputs().map((input) => input.value)).toEqual(['工作用']);
    expect(screen.getByText('已刪除 API key「個人」')).toBeTruthy();
  });

  it('有未儲存的修改時切換到模型分頁會詢問；改回原樣後不詢問、儲存按鈕不能按', async () => {
    await renderPage();
    type(nameInputs()[0], '主要');
    expect(saveButton().disabled).toBe(false);

    fireEvent.click(screen.getByRole('tab', { name: '模型' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('修改還沒儲存，確定不儲存並離開嗎？');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('tab', { name: 'API key' }).getAttribute('aria-selected')).toBe('true');

    type(nameInputs()[0], '個人');
    expect(saveButton().disabled).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole('tab', { name: '模型' })));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('tab', { name: '模型' }).getAttribute('aria-selected')).toBe('true');
  });

  it('確定捨棄後切換分頁，回到 API key 分頁時修改已經不見', async () => {
    await renderPage();
    type(nameInputs()[0], '主要');
    fireEvent.click(screen.getByRole('tab', { name: '模型' }));
    const dialog = await screen.findByRole('dialog');
    await act(async () =>
      fireEvent.click(within(dialog).getByRole('button', { name: '不儲存並離開' })),
    );

    await act(async () => fireEvent.click(screen.getByRole('tab', { name: 'API key' })));
    expect(nameInputs()[0].value).toBe('個人');
  });

  it('後端連不上時按儲存，列下方顯示「無法連線到平台，請確認平台是否還在執行」', async () => {
    await renderPage();
    routes.updateApiKey = () => {
      throw new TypeError('Failed to fetch');
    };
    type(nameInputs()[0], '主要');
    await clickSave();

    expect(screen.getByText('無法連線到平台，請確認平台是否還在執行')).toBeTruthy();
    expect(screen.getByText('儲存失敗').className).toContain('is-danger');
    expect(nameInputs()[0].value).toBe('主要');
  });

  it('進入時查詢失敗：顯示「載入失敗」和「重試」，按重試後重新查詢', async () => {
    let isBackendDown = true;
    routes.listApiKeys = () => {
      if (isBackendDown) throw new TypeError('Failed to fetch');
      return Response.json({ keys: savedKeys });
    };
    render(<ApiSettings />);

    expect(await screen.findByText('載入失敗')).toBeTruthy();
    isBackendDown = false;
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByRole('tab', { name: 'API key' })).toBeTruthy();
  });
});
