// @vitest-environment jsdom
// 新增模型視窗：四步依序開放、偵測與能力提示、資訊卡、價格欄位、測試後才能儲存、清空後面的步驟、Forge 沒啟動、關閉前詢問。

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { ApiKeySummary, ModelType } from '../../../shared/PlatformInfrastructure/types.ts';
import { closeAllModals, OverlayHost } from '../SharedComponents/index.ts';
import { openAddModelDialog } from './AddModelDialog.tsx';
import { ApiSettings } from './ApiSettings.tsx';
import {
  DETECTED_LLMS,
  errorResponse,
  GROK_KEY,
  installFakeBackend,
  OPENROUTER_KEY,
  OPENROUTER_LLM,
  type FakeRoute,
} from './pageTestSupport.ts';

const GROK_LLM_WITH_SEARCH = { ...DETECTED_LLMS[0], id: 'grok-4', displayName: 'Grok 4' };
const FORGE_MODEL = {
  id: 'waiIllustriousSDXL_v150',
  displayName: 'waiIllustriousSDXL_v150',
  type: 'image',
  params: [],
  inputKinds: ['text'],
  outputKinds: ['image'],
};

let routes: Record<string, FakeRoute>;
let backend: ReturnType<typeof installFakeBackend>;
let onSaved: Mock<() => void>;

beforeEach(() => {
  routes = {
    detectModels: (body) => {
      if (body.provider === 'forge') return Response.json({ models: [FORGE_MODEL] });
      if (body.provider === 'grok') return Response.json({ models: [GROK_LLM_WITH_SEARCH] });
      return Response.json({ models: DETECTED_LLMS });
    },
    testModel: () => Response.json({ isPassed: true }),
    addModel: (body) =>
      Response.json({ model: { ...OPENROUTER_LLM, id: 'new', displayName: body.displayName } }),
    writeLog: () => Response.json({ isWritten: true }),
  };
  backend = installFakeBackend(routes);
  onSaved = vi.fn<() => void>();
});

afterEach(() => {
  act(() => closeAllModals());
  cleanup();
  vi.unstubAllGlobals();
});

// ===== 輔助 =====

function openDialog(type: ModelType, savedKeys: ApiKeySummary[] = [OPENROUTER_KEY, GROK_KEY]) {
  render(<OverlayHost />);
  act(() => openAddModelDialog({ type, savedKeys, onSaved }));
  return screen.getByRole('dialog', { name: /新增模型/ });
}

/** 打開某個選單並選一項（選項的文字以 label 開頭）；回傳選單裡所有選項的文字。 */
async function choose(dialog: HTMLElement, selectName: string, label: string) {
  const trigger = within(dialog).getByRole('button', { name: selectName });
  fireEvent.click(trigger);
  const options = within(
    trigger.closest('.platform-infrastructure-select') as HTMLElement,
  ).getAllByRole('option');
  await act(async () => fireEvent.click(options.find((o) => o.textContent?.startsWith(label))!));
  return options.map((option) => option.textContent);
}

function stepOf(dialog: HTMLElement, title: string): HTMLElement {
  return within(dialog).getByText(title).closest('.platform-infrastructure-add-model-step')!;
}

function button(dialog: HTMLElement, name: string): HTMLButtonElement {
  return within(dialog).getByRole('button', { name }) as HTMLButtonElement;
}

/** 選到 OpenRouter 的 Claude Sonnet：供應商 → key → 模型。 */
async function chooseOpenRouterClaude(dialog: HTMLElement) {
  await choose(dialog, '供應商', 'OpenRouter');
  await choose(dialog, '連線', '個人');
  await choose(dialog, '模型', 'Anthropic: Claude Sonnet 5.5');
}

// ===== 測試 =====

describe('AddModelDialog', () => {
  it('供應商只列支援這個類型的供應商；前一步完成後下一步才能操作', async () => {
    const dialog = openDialog('image');
    expect(stepOf(dialog, '連線').className).toContain('is-disabled');
    expect(stepOf(dialog, '連線').textContent).toContain('先選供應商');
    const options = await choose(dialog, '供應商', 'Grok');
    expect(options).toEqual(['-- 請選擇 --', 'Grok', 'OpenRouter', 'Forge']);
    expect(stepOf(dialog, '連線').className).not.toContain('is-disabled');
    expect(stepOf(dialog, '模型').className).toContain('is-disabled');
  });

  it('選供應商和 key 後出現偵測結果和能力提示', async () => {
    const dialog = openDialog('llm');
    await choose(dialog, '供應商', 'OpenRouter');
    await choose(dialog, '連線', '個人');
    expect(backend.sentBodies('detectModels')).toEqual([
      { type: 'llm', provider: 'openrouter', keyId: 'k1' },
    ]);
    expect(await within(dialog).findByText('偵測到 2 個可用模型')).toBeTruthy();
    const options = await choose(dialog, '模型', 'Qwen3');
    expect(options).toContain(
      'Anthropic: Claude Sonnet 5.5context 1M・圖片・檔案・搜尋・思考・工具',
    );
    expect(options).toContain('Qwen3 235Bcontext 131K');
  });

  it('沒有這家的 key 時提示先到 API key 分頁新增', async () => {
    const dialog = openDialog('llm', [OPENROUTER_KEY]);
    await choose(dialog, '供應商', 'Claude');
    expect(stepOf(dialog, '連線').textContent).toContain('請先到 API key 分頁新增 key');
  });

  it('選 LLM 後資訊卡列出七項能力，「未知」為警告樣式並有說明', async () => {
    const dialog = openDialog('llm');
    await choose(dialog, '供應商', 'OpenRouter');
    await choose(dialog, '連線', '個人');
    await choose(dialog, '模型', 'Qwen3');
    const items = [...dialog.querySelectorAll('.platform-infrastructure-add-model-info-list div')];
    expect(items.map((item) => [item.textContent, item.className])).toEqual([
      ['context window 上限131K token', 'is-yes'],
      ['輸出上限未知', 'is-unknown'],
      ['傳圖片未知', 'is-unknown'],
      ['傳檔案未知', 'is-unknown'],
      ['網頁搜尋不支援', 'is-no'],
      ['思考未知', 'is-unknown'],
      ['調用工具未知', 'is-unknown'],
    ]);
    expect(dialog.textContent).toContain('標示未知的項目，供應商沒有提供資料');
  });

  it('網頁搜尋不是「不支援」時出現每次搜尋價格欄；OpenRouter 不顯示這欄', async () => {
    const grokDialog = openDialog('llm');
    await choose(grokDialog, '供應商', 'Grok');
    await choose(grokDialog, '連線', '個人');
    await choose(grokDialog, '模型', 'Grok 4');
    expect(within(grokDialog).getByLabelText('每次搜尋價格')).toBeTruthy();
    act(() => closeAllModals());
    cleanup();

    const openRouterDialog = openDialog('llm');
    await chooseOpenRouterClaude(openRouterDialog);
    expect(within(openRouterDialog).queryByLabelText('每次搜尋價格')).toBeNull();
  });

  it('顯示名稱預設帶入；自動帶入的價格標示「已自動帶入」，改過就拿掉；負數時紅框、不能儲存', async () => {
    const dialog = openDialog('llm');
    await chooseOpenRouterClaude(dialog);
    const name = within(dialog).getByLabelText('顯示名稱') as HTMLInputElement;
    expect(name.value).toBe('Anthropic: Claude Sonnet 5.5');
    const input = within(dialog).getByLabelText('輸入價格（每 100 萬 token）') as HTMLInputElement;
    expect(input.value).toBe('3');
    expect(within(dialog).getAllByText('已自動帶入')).toHaveLength(2);

    fireEvent.change(input, { target: { value: '-1' } });
    expect(within(dialog).getAllByText('已自動帶入')).toHaveLength(1);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(dialog.textContent).toContain('價格不能是負數');
    await act(async () => fireEvent.click(button(dialog, '測試')));
    expect(button(dialog, '儲存').disabled).toBe(true);
  });

  it('測試前不能儲存；測試成功後可以儲存；換模型要重新測試', async () => {
    const dialog = openDialog('llm');
    await chooseOpenRouterClaude(dialog);
    expect(button(dialog, '儲存').disabled).toBe(true);

    await act(async () => fireEvent.click(button(dialog, '測試')));
    expect(backend.sentBodies('testModel')).toEqual([
      { type: 'llm', provider: 'openrouter', keyId: 'k1', modelId: 'anthropic/claude-sonnet-5.5' },
    ]);
    expect(within(dialog).getByText('測試成功').className).toContain('is-success');
    expect(button(dialog, '儲存').disabled).toBe(false);

    await choose(dialog, '模型', 'Qwen3');
    expect(button(dialog, '儲存').disabled).toBe(true);
    expect(within(dialog).queryByText('測試成功')).toBeNull();
  });

  it('測試失敗時顯示紅色「測試失敗」和錯誤', async () => {
    routes.testModel = () => errorResponse('testModel', 'PROVIDER_KEY_INVALID');
    const dialog = openDialog('llm');
    await chooseOpenRouterClaude(dialog);
    await act(async () => fireEvent.click(button(dialog, '測試')));
    expect(within(dialog).getByText('測試失敗').className).toContain('is-danger');
    expect(await screen.findByText('API key 無效，請確認 key 是否正確')).toBeTruthy();
    expect(button(dialog, '儲存').disabled).toBe(true);
  });

  it('把供應商選回未選，後面的步驟全部清空', async () => {
    const dialog = openDialog('llm');
    await chooseOpenRouterClaude(dialog);
    await choose(dialog, '供應商', '-- 請選擇 --');
    expect(stepOf(dialog, '連線').textContent).toContain('先選供應商');
    expect(stepOf(dialog, '模型').textContent).toContain('先完成連線設定');
    expect(stepOf(dialog, '名稱與價格').textContent).toContain('先選模型');
    expect(button(dialog, '測試').disabled).toBe(true);
  });

  it('Forge 填位址按偵測；沒有啟動時在位址下方提示啟動 Forge，不顯示價格欄', async () => {
    routes.detectModels = () => errorResponse('detectModels', 'PROVIDER_FORGE_NOT_RUNNING', 500);
    const dialog = openDialog('image');
    await choose(dialog, '供應商', 'Forge');
    const address = within(dialog).getByLabelText('Forge 位址') as HTMLInputElement;
    expect(address.placeholder).toBe('http://127.0.0.1:7860');
    expect(button(dialog, '偵測').disabled).toBe(true);
    fireEvent.change(address, { target: { value: 'http://127.0.0.1:7861' } });
    await act(async () => fireEvent.click(button(dialog, '偵測')));
    expect(stepOf(dialog, '連線').textContent).toContain(
      '請先啟動 Forge（需加上 --api）或改用 API',
    );
    expect(stepOf(dialog, '模型').textContent).toContain('連上之後才能列出模型');

    routes.detectModels = () => Response.json({ models: [FORGE_MODEL] });
    await act(async () => fireEvent.click(button(dialog, '偵測')));
    await choose(dialog, '模型', 'waiIllustriousSDXL_v150');
    expect(stepOf(dialog, '名稱與價格').textContent).toContain('本機執行，不計費');
    expect(within(dialog).queryByLabelText('價格（每張）')).toBeNull();
  });

  it('儲存成功後直接關閉視窗並提示「已新增 <顯示名稱>」；只送有填的價格', async () => {
    const dialog = openDialog('llm');
    await chooseOpenRouterClaude(dialog);
    fireEvent.change(within(dialog).getByLabelText('顯示名稱'), {
      target: { value: ' 我的 Claude ' },
    });
    fireEvent.change(within(dialog).getByLabelText('輸出價格（每 100 萬 token）'), {
      target: { value: '' },
    });
    await act(async () => fireEvent.click(button(dialog, '測試')));
    await act(async () => fireEvent.click(button(dialog, '儲存')));

    expect(backend.sentBodies('addModel')).toEqual([
      {
        type: 'llm',
        provider: 'openrouter',
        keyId: 'k1',
        modelId: 'anthropic/claude-sonnet-5.5',
        displayName: '我的 Claude',
        price: { inputPerMillionTokens: 3 },
      },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('已新增 我的 Claude')).toBeTruthy();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('沒有修改時按 X 直接關閉；有修改時先詢問，取消後視窗還在', async () => {
    const emptyDialog = openDialog('llm');
    fireEvent.click(within(emptyDialog).getByRole('button', { name: '關閉' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();

    const dialog = openDialog('llm');
    await choose(dialog, '供應商', 'OpenRouter');
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉' }));
    const confirm = await screen.findByRole('dialog', { name: '尚未儲存' });
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '尚未儲存' })).toBeNull());
    expect(screen.getByRole('dialog', { name: /新增模型/ })).toBeTruthy();
  });
});

describe('AddModelDialog 與模型分頁', () => {
  it('從模型分頁的「新增模型」打開，儲存後模型列表重新載入', async () => {
    let savedModels = [OPENROUTER_LLM];
    routes.listApiKeys = () => Response.json({ keys: [OPENROUTER_KEY] });
    routes.listModels = () => Response.json({ models: savedModels });
    routes.addModel = (body) => {
      const model = { ...OPENROUTER_LLM, id: 'new', displayName: body.displayName as string };
      savedModels = [...savedModels, model];
      return Response.json({ model });
    };
    render(
      <>
        <ApiSettings />
        <OverlayHost />
      </>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: '模型' }));
    const llmSection = screen.getByRole('region', { name: 'LLM' });
    fireEvent.click(within(llmSection).getByRole('button', { name: '＋ 新增模型' }));
    const dialog = screen.getByRole('dialog', { name: /新增模型/ });
    expect(within(dialog).getByText('LLM')).toBeTruthy();

    await chooseOpenRouterClaude(dialog);
    await act(async () => fireEvent.click(button(dialog, '測試')));
    await act(async () => fireEvent.click(button(dialog, '儲存')));
    expect(await within(llmSection).findByText('Anthropic: Claude Sonnet 5.5')).toBeTruthy();
    expect(within(llmSection).getByText('2 個')).toBeTruthy();
  });
});
