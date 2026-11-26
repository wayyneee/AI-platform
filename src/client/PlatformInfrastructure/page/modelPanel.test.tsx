// @vitest-environment jsdom
// API 串接頁的模型分頁：四個區塊、價格、key 被刪除的紅框與重新選 key、測試、刪除模型、刪除 key 時列出模型數量。

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiKeySummary, SavedModel } from '../../../shared/PlatformInfrastructure/types.ts';
import { closeAllModals, OverlayHost } from '../SharedComponents/index.ts';
import { ApiSettings } from './ApiSettings.tsx';
import {
  errorResponse,
  GROK_KEY,
  installFakeBackend,
  OPENROUTER_KEY,
  OPENROUTER_LLM,
  SECOND_OPENROUTER_KEY,
  UNKNOWN_CAPABILITIES,
  type FakeRoute,
} from './pageTestSupport.ts';

const CLAUDE_LLM_WITH_SEARCH: SavedModel = {
  ...OPENROUTER_LLM,
  id: 'm2',
  provider: 'grok',
  modelId: 'grok-4',
  displayName: 'Grok 4',
  keyId: 'k3',
  price: { inputPerMillionTokens: 3, outputPerMillionTokens: 15, perSearch: 0.01 },
};
const GEMINI_WITHOUT_KEY: SavedModel = {
  ...OPENROUTER_LLM,
  id: 'm3',
  provider: 'gemini',
  modelId: 'gemini-2.5-flash',
  displayName: 'Gemini Flash',
  keyId: null,
  price: {},
  capabilities: UNKNOWN_CAPABILITIES,
};
const FORGE_IMAGE: SavedModel = {
  id: 'm4',
  type: 'image',
  provider: 'forge',
  modelId: 'waiIllustriousSDXL_v150',
  displayName: '插畫風（本機）',
  keyId: null,
  address: 'http://127.0.0.1:7860',
  price: {},
  capabilities: null,
  params: [],
};
const GROK_IMAGE: SavedModel = {
  ...FORGE_IMAGE,
  id: 'm5',
  provider: 'grok',
  modelId: 'grok-imagine-image',
  displayName: 'Grok 圖片',
  keyId: 'k3',
  address: null,
  price: { perUnit: 0.07 },
};

let savedKeys: ApiKeySummary[];
let savedModels: SavedModel[];
let routes: Record<string, FakeRoute>;
let backend: ReturnType<typeof installFakeBackend>;

beforeEach(() => {
  savedKeys = [OPENROUTER_KEY, SECOND_OPENROUTER_KEY, GROK_KEY];
  savedModels = [
    OPENROUTER_LLM,
    CLAUDE_LLM_WITH_SEARCH,
    GEMINI_WITHOUT_KEY,
    FORGE_IMAGE,
    GROK_IMAGE,
  ];
  routes = {
    listApiKeys: () => Response.json({ keys: savedKeys }),
    listModels: () => Response.json({ models: savedModels }),
    updateModelKey: (body) => {
      const model = savedModels.find((item) => item.id === body.id)!;
      return Response.json({ model: { ...model, keyId: body.keyId } });
    },
    testModel: () => Response.json({ isPassed: true }),
    deleteModel: (body) => Response.json({ model: savedModels.find((m) => m.id === body.id) }),
    deleteApiKey: (body) => Response.json({ key: savedKeys.find((key) => key.id === body.id) }),
    writeLog: () => Response.json({ isWritten: true }),
  };
  backend = installFakeBackend(routes);
});

afterEach(() => {
  act(() => closeAllModals());
  cleanup();
  vi.unstubAllGlobals();
});

// ===== 輔助 =====

async function openModelTab(): Promise<void> {
  render(
    <>
      <ApiSettings />
      <OverlayHost />
    </>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: '模型' }));
}

function section(typeName: string): HTMLElement {
  return screen.getByRole('region', { name: typeName });
}

/** 某個模型那一列。 */
function modelRow(displayName: string): HTMLElement {
  return screen.getByText(displayName).closest('.platform-infrastructure-model-row') as HTMLElement;
}

function keySelect(displayName: string): HTMLElement {
  return screen.getByRole('button', { name: `${displayName} 的 key` });
}

/** 某個選單裡的選項（每個選單的選項都在畫面上，要限定在這個選單裡找）。 */
function optionsOf(trigger: HTMLElement): HTMLElement[] {
  const root = trigger.closest('.platform-infrastructure-select') as HTMLElement;
  return within(root).getAllByRole('option');
}

function chooseKey(displayName: string, keyName: string): void {
  const trigger = keySelect(displayName);
  fireEvent.click(trigger);
  const option = optionsOf(trigger).find((item) => item.textContent?.startsWith(keyName));
  fireEvent.click(option!);
}

function isSelectInvalid(trigger: HTMLElement): boolean {
  return trigger.closest('.platform-infrastructure-select')!.className.includes('is-invalid');
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '儲存' });
}

// ===== 測試 =====

describe('ApiSettings：模型分頁', () => {
  it('由上往下四個區塊，標題列有類型名稱、模型數量、新增模型；沒有模型時顯示一行小字', async () => {
    await openModelTab();
    const titles = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(titles).toEqual(['LLM', '圖片', '影片', '語音']);
    expect(within(section('LLM')).getByText('3 個')).toBeTruthy();
    expect(within(section('圖片')).getByText('2 個')).toBeTruthy();
    expect(within(section('影片')).getByText('還沒有影片模型')).toBeTruthy();
    expect(within(section('語音')).getByRole('button', { name: '＋ 新增模型' })).toBeTruthy();
  });

  it('價格依類型顯示：LLM 每 100 萬 token（有每次搜尋價格時加上搜尋）、圖片每張、未設定、Forge 不計費', async () => {
    await openModelTab();
    expect(modelRow('DeepSeek V3').textContent).toContain('輸入 $0.30／輸出 $0.88每 100 萬 token');
    expect(modelRow('Grok 4').textContent).toContain('輸入 $3.00／輸出 $15.00・搜尋 $0.01／次');
    expect(modelRow('Gemini Flash').textContent).toContain('未設定價格');
    expect(modelRow('Grok 圖片').textContent).toContain('$0.07／張');
    expect(modelRow('插畫風（本機）').textContent).toContain('本機執行，不計費');
    expect(modelRow('插畫風（本機）').textContent).toContain('http://127.0.0.1:7860');
  });

  it('連線只列同供應商的 key；該供應商沒有任何 key 時提示先新增', async () => {
    await openModelTab();
    const options = optionsOf(keySelect('DeepSeek V3')).map((option) => option.textContent);
    expect(options).toEqual(['-- 請選擇 --', '個人sk-****a3f9', '測試用sk-****0c1e']);
    expect(modelRow('Gemini Flash').textContent).toContain('請先到 API key 分頁新增 Gemini 的 key');
    const geminiTest = within(modelRow('Gemini Flash')).getByRole('button', { name: '測試' });
    expect((geminiTest as HTMLButtonElement).disabled).toBe(true);
  });

  it('自己選回未選時紅框並提示「請選擇 key」、測試不能按；只有這種列時儲存不送出', async () => {
    await openModelTab();
    chooseKey('DeepSeek V3', '-- 請選擇 --');
    expect(isSelectInvalid(keySelect('DeepSeek V3'))).toBe(true);
    expect(modelRow('DeepSeek V3').textContent).toContain('請選擇 key');
    const testButton = within(modelRow('DeepSeek V3')).getByRole('button', { name: '測試' });
    expect((testButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => fireEvent.click(saveButton()));
    expect(screen.getByText('請先替紅框的模型選擇 key')).toBeTruthy();
    expect(backend.sentBodies('updateModelKey')).toEqual([]);
  });

  it('改選 key 後按儲存，把改選 key 的模型存起來；改回原樣不算修改', async () => {
    await openModelTab();
    expect(saveButton().disabled).toBe(true);
    chooseKey('DeepSeek V3', '測試用');
    expect(saveButton().disabled).toBe(false);
    chooseKey('DeepSeek V3', '個人');
    expect(saveButton().disabled).toBe(true);

    chooseKey('DeepSeek V3', '測試用');
    await act(async () => fireEvent.click(saveButton()));
    expect(backend.sentBodies('updateModelKey')).toEqual([{ id: 'm1', keyId: 'k2' }]);
    expect(screen.getByText('已儲存').className).toContain('is-success');
    expect(saveButton().disabled).toBe(true);
  });

  it('按測試用這列目前的設定（含還沒儲存的 key）測試，成功時提示「測試成功：<顯示名稱>」', async () => {
    await openModelTab();
    chooseKey('DeepSeek V3', '測試用');
    const testButton = within(modelRow('DeepSeek V3')).getByRole('button', { name: '測試' });
    await act(async () => fireEvent.click(testButton));
    expect(backend.sentBodies('testModel')).toEqual([
      { type: 'llm', provider: 'openrouter', keyId: 'k2', modelId: 'deepseek/deepseek-chat-v3' },
    ]);
    expect(await screen.findByText('測試成功：DeepSeek V3')).toBeTruthy();
  });

  it('測試失敗時顯示錯誤的白話說明和來源', async () => {
    routes.testModel = () => errorResponse('testModel', 'PROVIDER_KEY_INVALID');
    await openModelTab();
    const testButton = within(modelRow('Grok 4')).getByRole('button', { name: '測試' });
    await act(async () => fireEvent.click(testButton));
    expect(await screen.findByText('API key 無效，請確認 key 是否正確')).toBeTruthy();
    expect(screen.getByText(/PROVIDER_KEY_INVALID/)).toBeTruthy();
  });

  it('刪除模型先跳出危險確認，提醒其他模組的設定會失效；確認後刪除並提示', async () => {
    await openModelTab();
    fireEvent.click(within(modelRow('Grok 圖片')).getByRole('button', { name: '刪除' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('其他模組正在使用這個模型的設定會失效');
    expect(document.activeElement?.textContent).toBe('取消');
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: '刪除' })));

    expect(backend.sentBodies('deleteModel')).toEqual([{ id: 'm5' }]);
    expect(screen.queryByText('Grok 圖片')).toBeNull();
    expect(screen.getByText('已刪除模型「Grok 圖片」')).toBeTruthy();
    expect(within(section('圖片')).getByText('1 個')).toBeTruthy();
  });
});

describe('ApiSettings：刪除被模型選用的 key', () => {
  it('確認視窗列出模型數量；刪除後那些模型紅框並提示，選 key 儲存後紅框消失', async () => {
    render(
      <>
        <ApiSettings />
        <OverlayHost />
      </>,
    );
    await screen.findByRole('tab', { name: 'API key' });
    const grokRow = screen.getAllByText('Grok')[0].closest('.platform-infrastructure-key-item')!;
    fireEvent.click(within(grokRow as HTMLElement).getByRole('button', { name: '刪除' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('有 2 個模型正在使用「個人」（Grok）');
    savedKeys = savedKeys.filter((key) => key.id !== 'k3');
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: '刪除' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Grok 沒有 key 了：先補一組 Grok 的 key 再回來（模擬使用者新增後重新進入）
    savedKeys = [...savedKeys, { ...GROK_KEY, id: 'k9', name: '新的' }];
    savedModels = savedModels.map((model) =>
      model.keyId === 'k3' ? { ...model, keyId: null } : model,
    );
    cleanup();
    await openModelTab();
    expect(isSelectInvalid(keySelect('Grok 4'))).toBe(true);
    expect(modelRow('Grok 4').textContent).toContain('key 已被刪除，請重新選擇 key');

    chooseKey('Grok 4', '新的');
    await act(async () => fireEvent.click(saveButton()));
    expect(isSelectInvalid(keySelect('Grok 4'))).toBe(false);
    expect(modelRow('Grok 4').textContent).not.toContain('key 已被刪除');
  });

  it('刪除 key 後不重新載入，模型分頁也立刻顯示那些模型的 key 已被刪除', async () => {
    savedKeys = [OPENROUTER_KEY, SECOND_OPENROUTER_KEY];
    render(
      <>
        <ApiSettings />
        <OverlayHost />
      </>,
    );
    await screen.findByRole('tab', { name: 'API key' });
    fireEvent.click(screen.getAllByRole('button', { name: '刪除' })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('有 1 個模型正在使用「個人」（OpenRouter）');
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: '刪除' })));

    fireEvent.click(screen.getByRole('tab', { name: '模型' }));
    expect(isSelectInvalid(keySelect('DeepSeek V3'))).toBe(true);
    expect(modelRow('DeepSeek V3').textContent).toContain('key 已被刪除，請重新選擇 key');
  });
});
