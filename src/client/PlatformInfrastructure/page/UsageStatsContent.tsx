// 花費統計的圖表區：沒有價格的提示、花費圖、Token 圖、沒有用量的空狀態、用量摘要；換 key 或時間單位時蓋上讀取中。

import type { UsageStats } from '../../../shared/PlatformInfrastructure/types.ts';
import { EmptyState, joinClassNames, LoadingState } from '../SharedComponents/index.ts';
import { getText } from '../ThemeAndLanguage/index.ts';
import { UsageBarChart, type ChartSegment } from './UsageBarChart.tsx';
import {
  formatMoney,
  formatMoneyTick,
  formatNumber,
  formatTokenTick,
  hasAnyUsage,
  listOptionalAmounts,
  priceStateOf,
  rangeLabel,
  type PriceState,
} from './usageDisplay.ts';

const COST_SEGMENTS: ChartSegment[] = [{ field: 'costUsd', className: 'is-cost' }];
const TOKEN_SEGMENTS: ChartSegment[] = [
  { field: 'inputTokens', className: 'is-input' },
  { field: 'outputTokens', className: 'is-output' },
];

const PRICE_NOTICE_KEYS: Partial<Record<PriceState, string>> = {
  none: 'PlatformInfrastructure.usageStats.noPriceNotice',
  partial: 'PlatformInfrastructure.usageStats.partialPriceNotice',
};

function text(name: string): string {
  return getText(`PlatformInfrastructure.usageStats.${name}`);
}

// ===== 圖表區 =====

/** 圖表區；isReloading 時蓋上讀取中，篩選列照常。 */
export function UsageStatsContent({
  stats,
  isReloading,
}: {
  stats: UsageStats;
  isReloading: boolean;
}) {
  const priceState = priceStateOf(stats.totals);
  const hasUsage = hasAnyUsage(stats.totals);
  return (
    <div
      className={joinClassNames(
        'platform-infrastructure-usage-charts',
        isReloading && 'is-loading',
      )}
      aria-busy={isReloading}
    >
      <div className="platform-infrastructure-usage-overlay">
        <LoadingState />
      </div>
      {hasUsage && priceState === 'partial' && <PriceNotice priceState={priceState} />}
      {hasUsage ? (
        <div className="platform-infrastructure-stack">
          <CostCard stats={stats} priceState={priceState} />
          {stats.totals.inputTokens + stats.totals.outputTokens > 0 && <TokenCard stats={stats} />}
        </div>
      ) : (
        <section className="platform-infrastructure-card">
          <EmptyState text={text('noUsage')}>
            <div className="platform-infrastructure-hint">{text('noUsageHint')}</div>
          </EmptyState>
        </section>
      )}
      <UsageSummary stats={stats} priceState={priceState} />
    </div>
  );
}

// ===== 長條圖卡片 =====

/** 花費圖（美元）；整段都算不出花費時改為提示，只看 Token 圖和摘要。 */
function CostCard({ stats, priceState }: { stats: UsageStats; priceState: PriceState }) {
  const isNoPrice = priceState === 'none';
  return (
    <section className="platform-infrastructure-card">
      <div className="platform-infrastructure-card-header">
        <CardTitle title={text('costChartTitle')} eyebrow={text('costChartEyebrow')} />
        <span className="platform-infrastructure-card-header-spacer" />
        <div className="platform-infrastructure-usage-legend">
          {priceState === 'partial' && (
            <span className="platform-infrastructure-usage-legend-item">
              <span className="platform-infrastructure-usage-swatch is-flag" />
              {text('unpricedLegend')}
            </span>
          )}
          {!isNoPrice && (
            <span className="platform-infrastructure-usage-unit">{text('costUnit')}</span>
          )}
        </div>
      </div>
      {isNoPrice ? (
        <div className="platform-infrastructure-usage-notice platform-infrastructure-usage-no-price">
          <span className="platform-infrastructure-usage-notice-icon">!</span>
          <span>{text('noPriceNotice')}</span>
        </div>
      ) : (
        <UsageBarChart
          slots={stats.slots}
          unit={stats.unit}
          segments={COST_SEGMENTS}
          formatTick={formatMoneyTick}
          priceState={priceState}
          isFlagShown={priceState === 'partial'}
        />
      )}
    </section>
  );
}

/** Token 圖：輸入、輸出疊成一根。 */
function TokenCard({ stats }: { stats: UsageStats }) {
  const priceState = priceStateOf(stats.totals);
  return (
    <section className="platform-infrastructure-card">
      <div className="platform-infrastructure-card-header">
        <CardTitle title={text('tokenChartTitle')} eyebrow={text('tokenChartEyebrow')} />
        <span className="platform-infrastructure-card-header-spacer" />
        <div className="platform-infrastructure-usage-legend">
          <span className="platform-infrastructure-usage-legend-item">
            <span className="platform-infrastructure-usage-swatch is-input" />
            {text('inputLegend')}
          </span>
          <span className="platform-infrastructure-usage-legend-item">
            <span className="platform-infrastructure-usage-swatch is-output" />
            {text('outputLegend')}
          </span>
        </div>
      </div>
      <UsageBarChart
        slots={stats.slots}
        unit={stats.unit}
        segments={TOKEN_SEGMENTS}
        formatTick={formatTokenTick}
        priceState={priceState}
        isFlagShown={false}
      />
    </section>
  );
}

function CardTitle({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <h2 className="platform-infrastructure-card-title">
      {title}
      <span className="platform-infrastructure-eyebrow">{eyebrow}</span>
    </h2>
  );
}

// ===== 用量摘要 =====

/** 一定顯示總花費、輸入 token、輸出 token；其他有值才顯示；沒有價格時加上同樣的提示。 */
function UsageSummary({ stats, priceState }: { stats: UsageStats; priceState: PriceState }) {
  const { totals } = stats;
  const items = [
    { label: text('inputTokens'), value: formatNumber(totals.inputTokens) },
    { label: text('outputTokens'), value: formatNumber(totals.outputTokens) },
    ...listOptionalAmounts(totals),
  ];
  return (
    <section className="platform-infrastructure-card" aria-label={text('summaryTitle')}>
      <h2 className="platform-infrastructure-card-title">
        {text('summaryTitle')}
        <span className="platform-infrastructure-eyebrow">{text('summaryEyebrow')}</span>
        <span className="platform-infrastructure-card-title-line" />
        <span className="platform-infrastructure-usage-unit">
          {rangeLabel(stats.slots, stats.unit)}
        </span>
      </h2>
      <div className="platform-infrastructure-usage-summary">
        <div className="platform-infrastructure-usage-stat is-highlight">
          <div className="platform-infrastructure-usage-stat-label">{text('totalCost')}</div>
          <div className="platform-infrastructure-usage-stat-value">
            {priceState === 'none' ? text('costUnavailable') : formatMoney(totals.costUsd)}
          </div>
          {priceState === 'partial' && (
            <div className="platform-infrastructure-usage-stat-note">{text('partialCostNote')}</div>
          )}
        </div>
        {items.map((item) => (
          <div key={item.label} className="platform-infrastructure-usage-stat">
            <div className="platform-infrastructure-usage-stat-label">{item.label}</div>
            <div className="platform-infrastructure-usage-stat-value">{item.value}</div>
          </div>
        ))}
      </div>
      {PRICE_NOTICE_KEYS[priceState] && <PriceNotice priceState={priceState} />}
    </section>
  );
}

function PriceNotice({ priceState }: { priceState: PriceState }) {
  return (
    <div className="platform-infrastructure-usage-notice" role="note">
      <span className="platform-infrastructure-usage-notice-icon">!</span>
      <span>{getText(PRICE_NOTICE_KEYS[priceState] ?? '')}</span>
    </div>
  );
}
