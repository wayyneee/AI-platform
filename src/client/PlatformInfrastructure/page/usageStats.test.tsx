// @vitest-environment jsdom
// 花費統計頁：估算提示、key 選單、時間單位與格數、沒有價格的提示、沒有用量與沒有紀錄、刪除已刪除 key 的紀錄、載入失敗。

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  USAGE_SLOT_COUNTS,
  type UsageAmounts,
  type UsageKey,
  type UsageSlot,
  type UsageStatsResult,
  type UsageUnit,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { closeAllModals, OverlayHost } from '../SharedComponents/index.ts';
import { errorResponse, installFakeBackend, type FakeRoute } from './pageTestSupport.ts';
import { UsageStats } from './UsageStats.tsx';

const ACTIVE_KEY: UsageKey = { id: 'k1', provider: 'openrouter', name: '個人', isDeleted: false };
const SECOND_KEY: UsageKey = { id: 'k2', provider: 'claude', name: '工作用', isDeleted: false };
const DELETED_KEY: UsageKey = { id: 'd1', provider: 'gemini', name: '舊帳號', isDeleted: true };

const PRICED_SLOT: Partial<UsageAmounts> = {
  costUsd: 1.25,
  inputTokens: 40_000,
  outputTokens: 9_000,
  hasPricedUsage: true,
};

let keys: UsageKey[];
/** 每組 key 最後一格（現在）的用量；沒給的 key 沒有用量 */
let usageByKey: Record<string, Partial<UsageAmounts>>;
let routes: Record<string, FakeRoute>;
let sentBodies: (interfaceName: string) => unknown[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  keys = [ACTIVE_KEY, SECOND_KEY, DELETED_KEY];
  usageByKey = { k1: PRICED_SLOT };
  routes = {
    getUsageStats: (_body, query) => Response.json(buildResult(query)),
    deleteUsage: (body) => {
      keys = keys.filter((key) => key.id !== body.keyId);
      return Response.json({ deletedCount: 3 });
    },
    writeLog: () => Response.json({ isWritten: true }),
  };
  ({ sentBodies, fetchMock } = installFakeBackend(routes));
});

afterEach(() => {
  act(() => closeAllModals());
  cleanup();
  vi.unstubAllGlobals();
});

// ===== 假資料 =====

/** 依查詢條件產生統計：每個時間單位的格數照真的，用量放在最後一格。 */
function buildResult(query: URLSearchParams): UsageStatsResult {
  if (keys.length === 0) return { keys, stats: null };
  const unit = query.get('unit') as UsageUnit;
  const keyId = query.get('keyId') ?? keys[0].id;
  const count = USAGE_SLOT_COUNTS[unit];
  const slots: UsageSlot[] = Array.from({ length: count }, (_, index) => ({
    ...emptyAmounts(),
    start: new Date(2026, 10, 26 - (count - 1 - index)).toISOString(),
    ...(index === count - 1 ? usageByKey[keyId] : {}),
  }));
  return {
    keys,
    stats: { keyId, unit, slots, totals: { ...emptyAmounts(), ...usageByKey[keyId] } },
  };
}

function emptyAmounts(): UsageAmounts {
  return {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    searchCount: 0,
    imageCount: 0,
    videoSeconds: 0,
    characterCount: 0,
    hasPricedUsage: false,
    hasUnpricedUsage: false,
  };
}

// ===== 輔助 =====

async function renderPage(): Promise<void> {
  render(
    <>
      <UsageStats />
      <OverlayHost />
    </>,
  );
  await screen.findByRole('tab', { name: '每天' });
}

function keySelect(): HTMLElement {
  return screen.getByRole('button', { name: 'API key' });
}

function keyOptions(): string[] {
  const root = keySelect().closest('.platform-infrastructure-select') as HTMLElement;
  return within(root)
    .getAllByRole('option')
    .map((option) => option.textContent ?? '');
}

async function chooseKey(label: string): Promise<void> {
  fireEvent.click(keySelect());
  const root = keySelect().closest('.platform-infrastructure-select') as HTMLElement;
  fireEvent.click(within(root).getByRole('option', { name: label }));
  await waitFor(() => expect(keySelect().textContent).toBe(label));
  await waitForReloaded();
}

async function chooseUnit(label: string): Promise<void> {
  fireEvent.click(screen.getByRole('tab', { name: label }));
  await waitForReloaded();
}

async function waitForReloaded(): Promise<void> {
  await waitFor(() =>
    expect(
      document.querySelector('.platform-infrastructure-usage-charts')?.getAttribute('aria-busy'),
    ).toBe('false'),
  );
}

function slotCount(): number {
  return screen.getAllByTestId('usage-chart-slot').length / chartCount();
}

function chartCount(): number {
  return document.querySelectorAll('.platform-infrastructure-usage-chart').length;
}

function summaryText(): string {
  return screen.getByRole('region', { name: '用量摘要' }).textContent ?? '';
}

// ===== 篩選列與格數 =====

describe('花費統計一直顯示「花費是估算」的提示；切換時間單位，格數為 24、30、12、12', () => {
  it('一直顯示花費是估算的提示，預設選第一組 key、每天', async () => {
    await renderPage();
    expect(
      screen.getByText('花費是依模型價格估算的參考值，實際金額以各供應商的帳單為準'),
    ).toBeTruthy();
    expect(keySelect().textContent).toBe('個人（OpenRouter）');
    expect(screen.getByRole('tab', { name: '每天' }).getAttribute('aria-selected')).toBe('true');
    expect(sentBodies('getUsageStats')).toHaveLength(1);
  });

  it('切換時間單位，格數為 24、30、12、12', async () => {
    await renderPage();
    const counts: Record<string, number> = {};
    counts['每天'] = slotCount();
    for (const label of ['每小時', '每週', '每月']) {
      await chooseUnit(label);
      counts[label] = slotCount();
    }
    expect(counts).toEqual({ 每小時: 24, 每天: 30, 每週: 12, 每月: 12 });
  });

  it('換時間單位時照目前的 key 查詢', async () => {
    await renderPage();
    await chooseKey('工作用（Claude）');
    await chooseUnit('每週');
    const lastUrl = String(fetchMock.mock.calls.at(-1)![0]);
    expect(lastUrl).toContain('unit=week');
    expect(lastUrl).toContain('keyId=k2');
  });
});

describe('花費統計的 key 選單沒有「-- 請選擇 --」', () => {
  it('key 選單列出「名稱（供應商）」，已刪除的 key 標示已刪除，沒有「-- 請選擇 --」', async () => {
    await renderPage();
    expect(keyOptions()).toEqual([
      '個人（OpenRouter）',
      '工作用（Claude）',
      '舊帳號（Gemini）・已刪除',
    ]);
  });
});

// ===== 價格 =====

describe('沒填價格時出現對應提示', () => {
  it('全部有價格時顯示花費圖、Token 圖和總花費，沒有價格的提示', async () => {
    await renderPage();
    expect(chartCount()).toBe(2);
    expect(summaryText()).toContain('$1.25');
    expect(summaryText()).toContain('40,000');
    expect(screen.queryByText('部分用量沒有設定價格，花費只計算有價格的部分')).toBeNull();
  });

  it('整段都沒有價格時，花費圖改為提示，總花費為「無法計算」', async () => {
    usageByKey.k1 = { inputTokens: 5000, outputTokens: 800, hasUnpricedUsage: true };
    await renderPage();
    expect(
      screen.getAllByText('這組 key 用到的模型沒有設定價格，無法計算花費，只顯示用量'),
    ).toHaveLength(2);
    expect(chartCount()).toBe(1);
    expect(summaryText()).toContain('無法計算');
  });

  it('部分沒有價格時，上方和摘要都提示，有未計價用量的格子加標記', async () => {
    usageByKey.k1 = { ...PRICED_SLOT, hasUnpricedUsage: true };
    await renderPage();
    expect(screen.getAllByText('部分用量沒有設定價格，花費只計算有價格的部分')).toHaveLength(2);
    expect(screen.getByText('只計算有價格的部分')).toBeTruthy();
    expect(document.querySelectorAll('.platform-infrastructure-usage-chart-flag')).toHaveLength(1);
  });

  it('沒有 token 用量時不顯示 Token 圖；有值才顯示圖片張數', async () => {
    usageByKey.k1 = { costUsd: 0.28, imageCount: 4, hasPricedUsage: true };
    await renderPage();
    expect(chartCount()).toBe(1);
    expect(summaryText()).toContain('4 張');
    expect(summaryText()).not.toContain('網頁搜尋');
  });
});

// ===== 空狀態 =====

describe('沒有用量與沒有任何紀錄', () => {
  it('選的 key 這段期間沒有用量時，圖表區顯示「這段期間沒有用量」', async () => {
    await renderPage();
    await chooseKey('工作用（Claude）');
    expect(screen.getByText('這段期間沒有用量')).toBeTruthy();
    expect(chartCount()).toBe(0);
  });

  it('沒有任何 key 也沒有用量紀錄時，篩選列和圖表區改為「還沒有任何用量紀錄」', async () => {
    keys = [];
    render(<UsageStats />);
    expect(await screen.findByText('還沒有任何用量紀錄')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'API key' })).toBeNull();
  });
});

// ===== 刪除紀錄 =====

describe('刪除已刪除 key 的紀錄後，它從選單消失', () => {
  it('只有已刪除的 key 有「刪除紀錄」按鈕', async () => {
    await renderPage();
    expect(screen.queryByRole('button', { name: '刪除紀錄' })).toBeNull();
    await chooseKey('舊帳號（Gemini）・已刪除');
    expect(screen.getByRole('button', { name: '刪除紀錄' })).toBeTruthy();
  });

  it('確認後刪除紀錄、提示，選單不再列出它並回到第一組 key', async () => {
    await renderPage();
    await chooseKey('舊帳號（Gemini）・已刪除');
    fireEvent.click(screen.getByRole('button', { name: '刪除紀錄' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除' }));

    await waitFor(() => expect(keySelect().textContent).toBe('個人（OpenRouter）'));
    expect(sentBodies('deleteUsage')).toEqual([{ keyId: 'd1' }]);
    expect(screen.getByText('已刪除「舊帳號（Gemini）」的用量紀錄')).toBeTruthy();
    expect(keyOptions()).not.toContain('舊帳號（Gemini）・已刪除');
  });

  it('取消時不刪除', async () => {
    await renderPage();
    await chooseKey('舊帳號（Gemini）・已刪除');
    fireEvent.click(screen.getByRole('button', { name: '刪除紀錄' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sentBodies('deleteUsage')).toEqual([]);
  });
});

// ===== 載入失敗 =====

describe('平台開著時關掉後端，重新查詢時錯誤訊息為「無法連線到平台，請確認平台是否還在執行」', () => {
  it('查詢失敗時顯示「載入失敗」和錯誤，按重試後恢復', async () => {
    routes.getUsageStats = () => errorResponse('getUsageStats', 'DATABASE_QUERY_FAILED', 500);
    render(<UsageStats />);
    expect(await screen.findByText('載入失敗')).toBeTruthy();
    expect(screen.getByText('讀寫資料庫時發生問題，請稍後再試')).toBeTruthy();

    routes.getUsageStats = (_body, query) => Response.json(buildResult(query));
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByRole('tab', { name: '每天' })).toBeTruthy();
  });

  it('換時間單位時連不上後端，顯示無法連線到平台', async () => {
    await renderPage();
    routes.getUsageStats = () => {
      throw new TypeError('Failed to fetch');
    };
    fireEvent.click(screen.getByRole('tab', { name: '每月' }));
    expect(await screen.findByText('無法連線到平台，請確認平台是否還在執行')).toBeTruthy();
  });
});
