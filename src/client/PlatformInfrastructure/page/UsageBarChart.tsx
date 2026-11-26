// 花費統計的長條圖：Y 軸刻度與格線、每格一根（可以疊加）、X 軸標籤，滑鼠移到格子上顯示這一格的用量。

import { useRef, useState, type Ref } from 'react';

import type { UsageSlot, UsageUnit } from '../../../shared/PlatformInfrastructure/types.ts';
import { joinClassNames } from '../SharedComponents/index.ts';
import { getText } from '../ThemeAndLanguage/index.ts';
import {
  axisLabel,
  CHART_TICKS,
  formatMoney,
  formatNumber,
  isAxisLabelShown,
  listOptionalAmounts,
  niceMax,
  tooltipTitle,
  type PriceState,
} from './usageDisplay.ts';

// 說明框還沒量到寬度時，用這個值估算，避免第一次出現時超出卡片
const FALLBACK_TOOLTIP_HALF_WIDTH = 100;

/** 一根長條裡的一段：用哪個數字、什麼顏色。 */
export interface ChartSegment {
  field: 'costUsd' | 'inputTokens' | 'outputTokens';
  className: string;
}

interface UsageBarChartProps {
  slots: UsageSlot[];
  unit: UsageUnit;
  segments: ChartSegment[];
  formatTick: (value: number) => string;
  /** 整段的價格狀態：部分沒有價格時，有未計價用量的格子加小標記 */
  priceState: PriceState;
  isFlagShown: boolean;
}

interface TooltipPosition {
  index: number;
  left: number;
  top: number;
}

// ===== 長條圖 =====

/** 一張長條圖。 */
export function UsageBarChart(props: UsageBarChartProps) {
  const { slots, unit, segments, formatTick } = props;
  const chartRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipPosition | null>(null);
  const totals = slots.map((slot) => segments.reduce((sum, s) => sum + slot[s.field], 0));
  const max = niceMax(Math.max(...totals));

  const showTooltip = (index: number, slotElement: HTMLElement) => {
    if (!chartRef.current) return;
    setTooltip({ index, ...placeTooltip(chartRef.current, slotElement, tooltipRef.current) });
  };

  return (
    <div className="platform-infrastructure-usage-chart" ref={chartRef}>
      <YAxis max={max} formatTick={formatTick} />
      <div
        className="platform-infrastructure-usage-chart-area"
        onMouseLeave={() => setTooltip(null)}
      >
        <GridLines />
        {slots.map((slot, index) => (
          <ChartSlot
            key={slot.start}
            slot={slot}
            total={totals[index]}
            max={max}
            segments={segments}
            isFlagged={props.isFlagShown && slot.hasUnpricedUsage}
            onHover={(element) => showTooltip(index, element)}
          />
        ))}
      </div>
      <XAxis slots={slots} unit={unit} />
      <SlotTooltip
        ref={tooltipRef}
        position={tooltip}
        slot={tooltip ? slots[tooltip.index] : null}
        unit={unit}
        priceState={props.priceState}
      />
    </div>
  );
}

function YAxis({ max, formatTick }: { max: number; formatTick: (value: number) => string }) {
  return (
    <div className="platform-infrastructure-usage-chart-y">
      {Array.from({ length: CHART_TICKS + 1 }, (_, tick) => (
        <span
          key={tick}
          className="platform-infrastructure-usage-chart-y-label"
          style={{ bottom: `${(tick / CHART_TICKS) * 100}%` }}
        >
          {formatTick((max * tick) / CHART_TICKS)}
        </span>
      ))}
    </div>
  );
}

function XAxis({ slots, unit }: { slots: UsageSlot[]; unit: UsageUnit }) {
  return (
    <div className="platform-infrastructure-usage-chart-x">
      {slots.map((slot, index) => (
        <span key={slot.start} className="platform-infrastructure-usage-chart-x-label">
          {isAxisLabelShown(index, slots.length, unit) ? axisLabel(slot, unit) : ''}
        </span>
      ))}
    </div>
  );
}

function GridLines() {
  return Array.from({ length: CHART_TICKS }, (_, index) => (
    <span
      key={index}
      className="platform-infrastructure-usage-chart-grid"
      style={{ bottom: `${((index + 1) / CHART_TICKS) * 100}%` }}
    />
  ));
}

interface ChartSlotProps {
  slot: UsageSlot;
  total: number;
  max: number;
  segments: ChartSegment[];
  isFlagged: boolean;
  onHover: (element: HTMLElement) => void;
}

/** 一格：整欄都是滑鼠感應範圍；長條的高度依刻度最大值，裡面各段依占比分。 */
function ChartSlot({ slot, total, max, segments, isFlagged, onHover }: ChartSlotProps) {
  return (
    <div
      className="platform-infrastructure-usage-chart-slot"
      data-testid="usage-chart-slot"
      onMouseEnter={(event) => onHover(event.currentTarget)}
    >
      {isFlagged && <span className="platform-infrastructure-usage-chart-flag" />}
      <span
        className="platform-infrastructure-usage-chart-bar"
        style={{ height: `${max > 0 ? (total / max) * 100 : 0}%` }}
      >
        {segments
          .filter((segment) => slot[segment.field] > 0)
          .map((segment) => (
            // flex-grow 用占比（加總為 1）：直接放金額時，總和小於 1 長條就填不滿
            <span
              key={segment.field}
              className={joinClassNames(
                'platform-infrastructure-usage-chart-segment',
                segment.className,
              )}
              style={{ flexGrow: slot[segment.field] / total }}
            />
          ))}
      </span>
    </div>
  );
}

// ===== 滑鼠說明 =====

interface SlotTooltipProps {
  ref: Ref<HTMLDivElement>;
  position: TooltipPosition | null;
  slot: UsageSlot | null;
  unit: UsageUnit;
  priceState: PriceState;
}

/** 一定顯示時間、花費、token；搜尋、圖片、影片、語音有值才顯示（page.md）。 */
function SlotTooltip({ ref, position, slot, unit, priceState }: SlotTooltipProps) {
  const text = (name: string) => getText(`PlatformInfrastructure.usageStats.${name}`);
  return (
    <div
      ref={ref}
      role="tooltip"
      className={joinClassNames('platform-infrastructure-usage-tooltip', slot && 'is-visible')}
      style={position ? { left: position.left, top: position.top } : undefined}
    >
      {slot && (
        <>
          <div className="platform-infrastructure-usage-tooltip-title">
            {tooltipTitle(slot, unit)}
          </div>
          <TooltipRow
            label={text('cost')}
            value={priceState === 'none' ? text('costUnavailable') : formatMoney(slot.costUsd)}
          />
          <TooltipRow
            swatch="is-input"
            label={text('inputTokens')}
            value={formatNumber(slot.inputTokens)}
          />
          <TooltipRow
            swatch="is-output"
            label={text('outputTokens')}
            value={formatNumber(slot.outputTokens)}
          />
          {listOptionalAmounts(slot).map((amount) => (
            <TooltipRow key={amount.label} label={amount.label} value={amount.value} />
          ))}
          {priceState === 'partial' && slot.hasUnpricedUsage && (
            <div className="platform-infrastructure-usage-tooltip-note">
              <span className="platform-infrastructure-usage-swatch is-flag" />
              {text('tooltipUnpriced')}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TooltipRow({ label, value, swatch }: { label: string; value: string; swatch?: string }) {
  return (
    <div className="platform-infrastructure-usage-tooltip-row">
      <span>
        {swatch && (
          <span className={joinClassNames('platform-infrastructure-usage-swatch', swatch)} />
        )}
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
}

/** 說明框對齊在這一格的正上方；靠左右邊緣時往內收，不超出卡片。 */
function placeTooltip(chart: HTMLElement, slotElement: HTMLElement, tooltip: HTMLElement | null) {
  const chartRect = chart.getBoundingClientRect();
  const slotRect = slotElement.getBoundingClientRect();
  const halfWidth = (tooltip?.offsetWidth ?? 0) / 2 || FALLBACK_TOOLTIP_HALF_WIDTH;
  const center = slotRect.left + slotRect.width / 2 - chartRect.left;
  return {
    left: Math.min(Math.max(center, halfWidth), chartRect.width - halfWidth),
    top: slotRect.top - chartRect.top,
  };
}
