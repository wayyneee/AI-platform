// 花費統計：依時間單位把一組 key 的用量紀錄分格加總；以電腦的當地時間分格，沒有用量的格子也要有（spec 規則）。

import {
  USAGE_SLOT_COUNTS,
  type UsageAmounts,
  type UsageSlot,
  type UsageStats,
  type UsageStatsResult,
  type UsageUnit,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { listUsageKeys, listUsageRows, requireUsageKey, type UsageRow } from './usageRecords.ts';

const DAYS_PER_WEEK = 7;

/** 查詢花費統計的條件：沒給 keyId 時選第一組 key（page.md：預設第一個）。 */
export interface UsageStatsQuery {
  keyId?: string;
  unit: UsageUnit;
}

// ===== 主要流程 =====

/**
 * 花費統計頁要的內容：可以選的 key，以及選中那組 key 的統計；沒有任何 key 時 stats 為 null。
 * 指定的 key 不存在、也沒有紀錄時丟出 USAGE_KEY_NOT_FOUND；資料庫出錯時丟出 DATABASE_ 開頭的錯誤。
 */
export function getUsageStats(query: UsageStatsQuery): UsageStatsResult {
  const keys = listUsageKeys();
  if (keys.length === 0) return { keys, stats: null };
  const key = query.keyId ? requireUsageKey(keys, query.keyId, 'getUsageStats') : keys[0];
  return { keys, stats: buildStats(key.id, query.unit, new Date()) };
}

/** 一組 key 在某個時間單位下的統計：最後一格是現在所在的那一格。 */
function buildStats(keyId: string, unit: UsageUnit, now: Date): UsageStats {
  const slotStarts = listSlotStarts(unit, now);
  const slots: UsageSlot[] = slotStarts.map((start) => ({
    start: start.toISOString(),
    ...emptyAmounts(),
  }));
  const rangeEnd = slotStartBefore(unit, now, -1);
  for (const row of listUsageRows(keyId, slotStarts[0], rangeEnd)) {
    const index = findSlotIndex(slotStarts, new Date(row.recorded_at));
    addRow(slots[index], row);
  }
  return { keyId, unit, slots, totals: sumSlots(slots) };
}

// ===== 時間格 =====

/** 每一格的開始時間，由舊到新。 */
function listSlotStarts(unit: UsageUnit, now: Date): Date[] {
  const count = USAGE_SLOT_COUNTS[unit];
  return Array.from({ length: count }, (_, index) => slotStartBefore(unit, now, count - 1 - index));
}

/** 從現在所在的格子往前第 back 格的開始時間（back 為 -1 是下一格）；依當地時間，每週從週一開始。 */
function slotStartBefore(unit: UsageUnit, now: Date, back: number): Date {
  const year = now.getFullYear();
  const month = now.getMonth();
  const date = now.getDate();
  if (unit === 'hour') return new Date(year, month, date, now.getHours() - back);
  if (unit === 'day') return new Date(year, month, date - back);
  if (unit === 'week') {
    // getDay() 的週日是 0，換成「距離週一幾天」
    const daysSinceMonday = (now.getDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK;
    return new Date(year, month, date - daysSinceMonday - back * DAYS_PER_WEEK);
  }
  return new Date(year, month - back, 1);
}

/** 這筆紀錄落在哪一格：最後一個開始時間不晚於它的格子（查詢時已限定在範圍內）。 */
function findSlotIndex(slotStarts: Date[], recordedAt: Date): number {
  let index = 0;
  while (index + 1 < slotStarts.length && slotStarts[index + 1] <= recordedAt) index++;
  return index;
}

// ===== 加總 =====

function addRow(slot: UsageSlot, row: UsageRow): void {
  slot.inputTokens += row.input_tokens;
  slot.outputTokens += row.output_tokens;
  slot.searchCount += row.search_count;
  slot.imageCount += row.image_count;
  slot.videoSeconds += row.video_seconds;
  slot.characterCount += row.character_count;
  slot.costUsd += row.cost_usd;
  slot.hasPricedUsage ||= row.has_priced_usage === 1;
  slot.hasUnpricedUsage ||= row.has_unpriced_usage === 1;
}

function sumSlots(slots: UsageSlot[]): UsageAmounts {
  const totals = emptyAmounts();
  for (const slot of slots) {
    totals.inputTokens += slot.inputTokens;
    totals.outputTokens += slot.outputTokens;
    totals.searchCount += slot.searchCount;
    totals.imageCount += slot.imageCount;
    totals.videoSeconds += slot.videoSeconds;
    totals.characterCount += slot.characterCount;
    totals.costUsd += slot.costUsd;
    totals.hasPricedUsage ||= slot.hasPricedUsage;
    totals.hasUnpricedUsage ||= slot.hasUnpricedUsage;
  }
  return totals;
}

function emptyAmounts(): UsageAmounts {
  return {
    inputTokens: 0,
    outputTokens: 0,
    searchCount: 0,
    imageCount: 0,
    videoSeconds: 0,
    characterCount: 0,
    costUsd: 0,
    hasPricedUsage: false,
    hasUnpricedUsage: false,
  };
}
