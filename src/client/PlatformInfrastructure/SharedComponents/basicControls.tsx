// 基本元件：按鈕（主要、次要、危險；儲存中會轉圈並擋住重複點擊）、分頁標籤、標籤。

import type { ReactNode } from 'react';

// ===== 按鈕 =====

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'subtleDanger';

const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'platform-infrastructure-button-primary',
  secondary: 'platform-infrastructure-button-secondary',
  danger: 'platform-infrastructure-button-danger',
  subtleDanger: 'platform-infrastructure-button-subtle-danger',
};

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  isSmall?: boolean;
  isDisabled?: boolean;
  /** 處理中：轉圈、不能再按 */
  isBusy?: boolean;
  /** 處理中顯示的文字，例如「儲存中」；沒給時照常顯示按鈕文字 */
  busyLabel?: string;
  autoFocus?: boolean;
}

/** 按鈕；處理中時轉圈並擋住重複點擊（conventions.md 第 9 段：儲存回饋）。 */
export function Button({
  children,
  onClick,
  variant = 'primary',
  isSmall = false,
  isDisabled = false,
  isBusy = false,
  busyLabel,
  autoFocus,
}: ButtonProps) {
  const className = joinClassNames(
    'platform-infrastructure-button',
    BUTTON_VARIANT_CLASSES[variant],
    isSmall && 'platform-infrastructure-button-small',
    isBusy && 'is-busy',
  );
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={isDisabled || isBusy}
      aria-busy={isBusy}
      autoFocus={autoFocus}
    >
      {isBusy && <span className="platform-infrastructure-spinner" />}
      {isBusy && busyLabel ? busyLabel : children}
    </button>
  );
}

// ===== 分頁標籤 =====

export interface TabItem<Value extends string> {
  value: Value;
  label: string;
}

export interface TabsProps<Value extends string> {
  items: TabItem<Value>[];
  value: Value;
  onChange: (value: Value) => void;
}

/** 分頁標籤：一排可以切換的選項，目前的標示選中。 */
export function Tabs<Value extends string>({ items, value, onChange }: TabsProps<Value>) {
  return (
    <div className="platform-infrastructure-tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={item.value === value}
          className={joinClassNames(
            'platform-infrastructure-tab',
            item.value === value && 'is-active',
          )}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ===== 標籤 =====

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'accent';

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
}

/** 小標籤，例如 log 等級、供應商。 */
export function Badge({ children, tone = 'neutral' }: BadgeProps) {
  return (
    <span
      className={joinClassNames(
        'platform-infrastructure-badge',
        tone !== 'neutral' && `is-${tone}`,
      )}
    >
      {children}
    </span>
  );
}

// ===== 輔助 =====

/** 把有值的 class 名稱接起來；false、undefined 會被略過。 */
export function joinClassNames(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}
