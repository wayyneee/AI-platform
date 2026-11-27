// 花費統計頁：頁首 → 篩選列（key 選單、時間單位）→ 估算提示 → 圖表區與用量摘要。
// 換 key 或時間單位時圖表區蓋上讀取中；選到已刪除的 key 時可以刪除它的用量紀錄。

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  PlatformError,
  UsageKey,
  UsageStatsResult,
  UsageUnit,
} from '../../../shared/PlatformInfrastructure/types.ts';
import {
  Button,
  EmptyState,
  Select,
  showConfirm,
  showError,
  showToast,
  Tabs,
} from '../SharedComponents/index.ts';
import { toPlatformError } from '../SystemLog/index.ts';
import { getText } from '../ThemeAndLanguage/index.ts';
import { deleteUsage, getUsageStats } from '../UsageAndCost/index.ts';
import {
  LoadFailed,
  LoadingCard,
  SettingsHero,
  type SettingsHeroContent,
} from './settingsPageParts.tsx';
import { UsageStatsContent } from './UsageStatsContent.tsx';
import { usageKeyLabel, usageKeyName } from './usageDisplay.ts';

const MODULE_NAME = 'PlatformInfrastructure';
// page.md：時間單位預設每天
const DEFAULT_UNIT: UsageUnit = 'day';
const UNITS: UsageUnit[] = ['hour', 'day', 'week', 'month'];

const HERO: SettingsHeroContent = {
  displayKey: 'PlatformInfrastructure.usageStats.display',
  eyebrowKey: 'PlatformInfrastructure.usageStats.eyebrow',
  titleKey: 'PlatformInfrastructure.usageStats.title',
  descriptionKey: 'PlatformInfrastructure.usageStats.description',
  bannerAsset: 'usageStatsBanner',
};

type LoadState =
  | { status: 'loading' }
  | { status: 'failed'; error: PlatformError }
  | { status: 'ready'; result: UsageStatsResult };

function text(name: string, params?: Record<string, string>): string {
  return getText(`PlatformInfrastructure.usageStats.${name}`, params);
}

// ===== 頁面 =====

/** 花費統計頁。 */
export function UsageStats() {
  const { loadState, unit, isReloading, load } = useUsageStats();

  const changeKey = (keyId: string) => void load(unit, keyId, true);
  const changeUnit = (nextUnit: UsageUnit) => {
    if (nextUnit === unit || loadState.status !== 'ready') return;
    void load(nextUnit, loadState.result.stats?.keyId, true);
  };
  const deleteRecords = async (key: UsageKey) => {
    if (await confirmAndDeleteRecords(key)) void load(unit, undefined, true);
  };

  return (
    <div className="platform-infrastructure-page">
      <SettingsHero content={HERO} />
      {loadState.status === 'loading' && <LoadingCard />}
      {loadState.status === 'failed' && (
        <LoadFailed error={loadState.error} onRetry={() => void load(unit, undefined, false)} />
      )}
      {loadState.status === 'ready' && !loadState.result.stats && <NoRecords />}
      {loadState.status === 'ready' && loadState.result.stats && (
        <div className="platform-infrastructure-stack">
          <FilterBar
            keys={loadState.result.keys}
            keyId={loadState.result.stats.keyId}
            unit={unit}
            onKeyChange={changeKey}
            onUnitChange={changeUnit}
            onDeleteRecords={(key) => void deleteRecords(key)}
          />
          <div className="platform-infrastructure-usage-estimate" role="note">
            <span className="platform-infrastructure-usage-estimate-icon">i</span>
            <span>{text('estimateNotice')}</span>
          </div>
          <UsageStatsContent stats={loadState.result.stats} isReloading={isReloading} />
        </div>
      )}
    </div>
  );
}

// ===== 查詢 =====

/**
 * 查詢統計：進入時整頁讀取中；換 key 或時間單位（isReload）時保留畫面、圖表區蓋上讀取中。
 * 查詢失敗時改為「載入失敗」和「重試」。只採用最後一次查詢的結果，連續切換時舊的回應不會蓋掉新的。
 */
function useUsageStats() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [unit, setUnit] = useState<UsageUnit>(DEFAULT_UNIT);
  const [isReloading, setIsReloading] = useState(false);
  const latestRequest = useRef(0);

  const load = useCallback(
    async (nextUnit: UsageUnit, keyId: string | undefined, isReload: boolean) => {
      const requestId = ++latestRequest.current;
      setUnit(nextUnit);
      if (isReload) setIsReloading(true);
      else setLoadState({ status: 'loading' });
      try {
        const result = await getUsageStats(nextUnit, keyId);
        if (requestId !== latestRequest.current) return;
        setLoadState({ status: 'ready', result });
      } catch (error) {
        if (requestId !== latestRequest.current) return;
        setLoadState({
          status: 'failed',
          error: toPlatformError(error, MODULE_NAME, 'getUsageStats'),
        });
      }
      setIsReloading(false);
    },
    [],
  );

  useEffect(() => {
    void load(DEFAULT_UNIT, undefined, false);
  }, [load]);

  return { loadState, unit, isReloading, load };
}

/** 確認後刪除已刪除 key 的紀錄；成功回傳 true，失敗時顯示錯誤。 */
async function confirmAndDeleteRecords(key: UsageKey): Promise<boolean> {
  const name = usageKeyName(key);
  const isConfirmed = await showConfirm({
    title: text('deleteConfirmTitle'),
    message: text('deleteConfirmMessage', { key: name }),
    confirmLabel: text('deleteConfirmButton'),
    isDanger: true,
  });
  if (!isConfirmed) return false;
  try {
    await deleteUsage(key.id);
  } catch (error) {
    showError(toPlatformError(error, MODULE_NAME, 'deleteUsage'));
    return false;
  }
  showToast('success', text('deletedToast', { key: name }));
  return true;
}

// ===== 篩選列 =====

interface FilterBarProps {
  keys: UsageKey[];
  keyId: string;
  unit: UsageUnit;
  onKeyChange: (keyId: string) => void;
  onUnitChange: (unit: UsageUnit) => void;
  onDeleteRecords: (key: UsageKey) => void;
}

/** key 選單（有預設值，沒有「-- 請選擇 --」）、已刪除的 key 才有的「刪除紀錄」、時間單位分頁。 */
function FilterBar({
  keys,
  keyId,
  unit,
  onKeyChange,
  onUnitChange,
  onDeleteRecords,
}: FilterBarProps) {
  const selectedKey = keys.find((key) => key.id === keyId);
  return (
    <div className="platform-infrastructure-usage-filter">
      <span className="platform-infrastructure-usage-filter-label">{text('keyLabel')}</span>
      <Select
        value={keyId}
        options={keys.map((key) => ({ value: key.id, label: usageKeyLabel(key) }))}
        onChange={(value) => value !== keyId && onKeyChange(value)}
        ariaLabel={text('keyLabel')}
      />
      {selectedKey?.isDeleted && (
        <Button variant="subtleDanger" isSmall onClick={() => onDeleteRecords(selectedKey)}>
          {text('deleteRecords')}
        </Button>
      )}
      <span className="platform-infrastructure-usage-filter-spacer" />
      <Tabs
        items={UNITS.map((value) => ({ value, label: text(`unit.${value}`) }))}
        value={unit}
        onChange={onUnitChange}
      />
    </div>
  );
}

/** 沒有任何 key 也沒有用量紀錄：篩選列和圖表區改為空狀態。 */
function NoRecords() {
  return (
    <section className="platform-infrastructure-card">
      <EmptyState text={text('noRecords')}>
        <div className="platform-infrastructure-hint">{text('noRecordsHint')}</div>
      </EmptyState>
    </section>
  );
}
