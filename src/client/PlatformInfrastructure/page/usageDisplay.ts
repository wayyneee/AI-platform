// 花費統計的顯示文字與計算：價格狀態、金額與數字格式、時間格的標籤、長條圖的刻度。

import type {
  UsageAmounts,
  UsageKey,
  UsageSlot,
  UsageUnit,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { getText } from '../ThemeAndLanguage/index.ts';

/** 價格狀態：none 整段都算不出花費、partial 部分沒有價格、full 全部有價格（或沒有用量）。 */
export type PriceState = 'none' | 'partial' | 'full';

/** 長條圖的刻度數：0 以上畫 4 條格線。 */
export const CHART_TICKS = 4;

// X 軸每幾格標一次：每小時、每天的格子多，標太密會擠在一起
const AXIS_LABEL_EVERY: Record<UsageUnit, number> = { hour: 3, day: 3, week: 1, month: 1 };
// 刻度間距用這些數字 × 10 的次方，格線上的數字才會整齊
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 10];
const CENT = 0.01;
const THOUSAND = 1_000;
const MILLION = 1_000_000;
const DAYS_PER_WEEK = 7;

// ===== 價格狀態、用量 =====

export function priceStateOf(amounts: UsageAmounts): PriceState {
  if (amounts.hasUnpricedUsage && !amounts.hasPricedUsage) return 'none';
  if (amounts.hasUnpricedUsage) return 'partial';
  return 'full';
}

/** 有沒有任何用量（token、搜尋、圖片、影片、語音）。 */
export function hasAnyUsage(amounts: UsageAmounts): boolean {
  return (
    amounts.inputTokens +
      amounts.outputTokens +
      amounts.searchCount +
      amounts.imageCount +
      amounts.videoSeconds +
      amounts.characterCount >
    0
  );
}

/** 有值才顯示的用量：搜尋次數、圖片張數、影片秒數、語音字數，回傳名稱與帶單位的值。 */
export function listOptionalAmounts(amounts: UsageAmounts): { label: string; value: string }[] {
  const fields = ['searchCount', 'imageCount', 'videoSeconds', 'characterCount'] as const;
  return fields
    .filter((field) => amounts[field] > 0)
    .map((field) => ({
      label: getText(`PlatformInfrastructure.usageStats.${field}`),
      value: getText(`PlatformInfrastructure.usageStats.${field}Value`, {
        count: formatNumber(amounts[field]),
      }),
    }));
}

// ===== 數字格式 =====

/** 金額：兩位小數；大於 0 但不到 1 分錢時顯示「< $0.01」，不會被看成沒花錢。 */
export function formatMoney(value: number): string {
  if (value > 0 && value < CENT) return getText('PlatformInfrastructure.usageStats.lessThanCent');
  return `$${value.toFixed(2)}`;
}

/** 數字加上千分位；影片秒數可能有小數，最多留一位。 */
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/** 花費圖的刻度：至少兩位小數，間距是 0.025 這類數字時才多一位。 */
export function formatMoneyTick(value: number): string {
  return `$${value.toFixed(3).replace(/0$/, '')}`;
}

/** Token 圖的刻度：K、M 縮寫。 */
export function formatTokenTick(value: number): string {
  if (value >= MILLION) return `${roundToTenth(value / MILLION)}M`;
  if (value >= THOUSAND) return `${roundToTenth(value / THOUSAND)}K`;
  return String(Math.round(value));
}

/** 刻度最大值 = 整齊的間距 × 刻度數：每條格線都是整齊的數字，上方也不會空太多。 */
export function niceMax(value: number): number {
  if (value <= 0) return CHART_TICKS;
  const rawStep = value / CHART_TICKS;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const step = NICE_STEPS.find((candidate) => candidate * power >= rawStep) ?? 10;
  return step * power * CHART_TICKS;
}

// ===== 時間格 =====

/** X 軸：每小時 HH:00、每天 MM/DD、每週為週一的 MM/DD、每月 YYYY/MM（page.md）。 */
export function axisLabel(slot: UsageSlot, unit: UsageUnit): string {
  const start = new Date(slot.start);
  if (unit === 'hour') return `${pad(start.getHours())}:00`;
  if (unit === 'month') return yearMonth(start);
  return monthDay(start);
}

/** 最後一格（現在）一定標出來，其餘每隔幾格標一次。 */
export function isAxisLabelShown(index: number, slotCount: number, unit: UsageUnit): boolean {
  return (slotCount - 1 - index) % AXIS_LABEL_EVERY[unit] === 0;
}

/** 滑鼠說明的標題，例如「11/26 14:00～15:00」「11/26（四）」「11/23～11/29」「2026 年 11 月」。 */
export function tooltipTitle(slot: UsageSlot, unit: UsageUnit): string {
  const start = new Date(slot.start);
  const prefix = 'PlatformInfrastructure.usageStats';
  if (unit === 'hour') {
    return getText(`${prefix}.tooltipHour`, {
      date: monthDay(start),
      start: `${pad(start.getHours())}:00`,
      end: `${pad((start.getHours() + 1) % 24)}:00`,
    });
  }
  if (unit === 'day') {
    return getText(`${prefix}.tooltipDay`, {
      date: monthDay(start),
      weekday: getText(`${prefix}.weekday.${start.getDay()}`),
    });
  }
  if (unit === 'week') {
    return getText(`${prefix}.tooltipWeek`, {
      start: monthDay(start),
      end: monthDay(weekEnd(start)),
    });
  }
  return getText(`${prefix}.tooltipMonth`, {
    year: start.getFullYear(),
    month: start.getMonth() + 1,
  });
}

/** 摘要標題旁的範圍，例如「最近 30 天（10/28～11/26）」；每週寫到最後一週的週日。 */
export function rangeLabel(slots: UsageSlot[], unit: UsageUnit): string {
  const first = new Date(slots[0].start);
  const last = new Date(slots[slots.length - 1].start);
  const format = unit === 'month' ? yearMonth : monthDay;
  const end = unit === 'week' ? monthDay(weekEnd(last)) : format(last);
  return getText(`PlatformInfrastructure.usageStats.range.${unit}`, { start: format(first), end });
}

// ===== key =====

/** key 選單的文字：「名稱（供應商）」，已刪除的加上「・已刪除」。 */
export function usageKeyLabel(key: UsageKey): string {
  const label = getText('PlatformInfrastructure.usageStats.keyOption', {
    name: key.name,
    provider: getText(`PlatformInfrastructure.provider.${key.provider}`),
  });
  if (!key.isDeleted) return label;
  return getText('PlatformInfrastructure.usageStats.deletedKeyOption', { label });
}

/** 確認視窗與提示裡的 key 名稱：「名稱（供應商）」。 */
export function usageKeyName(key: UsageKey): string {
  return usageKeyLabel({ ...key, isDeleted: false });
}

// ===== 輔助 =====

function weekEnd(weekStart: Date): Date {
  return new Date(
    weekStart.getFullYear(),
    weekStart.getMonth(),
    weekStart.getDate() + DAYS_PER_WEEK - 1,
  );
}

function monthDay(date: Date): string {
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function yearMonth(date: Date): string {
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}
