// 花費統計的顯示文字：X 軸標籤、滑鼠說明的時間、摘要的範圍、金額與刻度。

import { describe, expect, it } from 'vitest';

import type { UsageSlot } from '../../../shared/PlatformInfrastructure/types.ts';
import {
  axisLabel,
  formatMoney,
  formatTokenTick,
  isAxisLabelShown,
  niceMax,
  rangeLabel,
  tooltipTitle,
} from './usageDisplay.ts';

/** 只有開始時間的一格（其他數字顯示時間時用不到）。 */
function slotAt(date: Date): UsageSlot {
  return { start: date.toISOString() } as UsageSlot;
}

describe('X 軸：每小時 HH:00、每天 MM/DD、每週為週一的 MM/DD、每月 YYYY/MM', () => {
  it('依時間單位顯示 X 軸標籤', () => {
    expect(axisLabel(slotAt(new Date(2026, 10, 26, 9)), 'hour')).toBe('09:00');
    expect(axisLabel(slotAt(new Date(2026, 10, 6)), 'day')).toBe('11/06');
    expect(axisLabel(slotAt(new Date(2026, 10, 23)), 'week')).toBe('11/23');
    expect(axisLabel(slotAt(new Date(2026, 0, 1)), 'month')).toBe('2026/01');
  });

  it('最後一格一定標出來，每小時、每天每 3 格標一次', () => {
    const shown = Array.from({ length: 30 }, (_, index) => isAxisLabelShown(index, 30, 'day'));
    expect(shown.at(-1)).toBe(true);
    expect(shown.filter(Boolean)).toHaveLength(10);
    expect(isAxisLabelShown(0, 12, 'month')).toBe(true);
  });
});

describe('滑鼠說明的時間與摘要的範圍', () => {
  it('滑鼠說明的標題依時間單位顯示', () => {
    expect(tooltipTitle(slotAt(new Date(2026, 10, 26, 23)), 'hour')).toBe('11/26 23:00～00:00');
    expect(tooltipTitle(slotAt(new Date(2026, 10, 26)), 'day')).toBe('11/26（四）');
    expect(tooltipTitle(slotAt(new Date(2026, 10, 23)), 'week')).toBe('11/23～11/29');
    expect(tooltipTitle(slotAt(new Date(2026, 10, 1)), 'month')).toBe('2026 年 11 月');
  });

  it('每週的範圍寫到最後一週的週日', () => {
    const slots = [slotAt(new Date(2026, 8, 7)), slotAt(new Date(2026, 10, 23))];
    expect(rangeLabel(slots, 'week')).toBe('最近 12 週（09/07～11/29）');
    const months = [slotAt(new Date(2025, 11, 1)), slotAt(new Date(2026, 10, 1))];
    expect(rangeLabel(months, 'month')).toBe('最近 12 個月（2025/12～2026/11）');
  });
});

describe('金額與刻度', () => {
  it('金額兩位小數；大於 0 但不到 1 分錢顯示「< $0.01」', () => {
    expect(formatMoney(1.256)).toBe('$1.26');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(0.004)).toBe('< $0.01');
  });

  it('刻度最大值是整齊的數字，至少比最大值大', () => {
    expect(niceMax(0)).toBe(4);
    expect(niceMax(1.7)).toBe(2);
    expect(niceMax(0.37)).toBeCloseTo(0.4);
    expect(niceMax(52_000)).toBe(60_000);
  });

  it('Token 刻度用 K、M 縮寫', () => {
    expect(formatTokenTick(15_000)).toBe('15K');
    expect(formatTokenTick(2_500_000)).toBe('2.5M');
    expect(formatTokenTick(800)).toBe('800');
  });
});
