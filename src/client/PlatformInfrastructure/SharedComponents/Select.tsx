// 下拉選單：依 conventions.md 第 9 段的下拉選單規則；可以用滑鼠或 ↑↓、Enter、Esc 操作，下方空間不夠時往上展開。

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import { getText } from '../ThemeAndLanguage/index.ts';
import { joinClassNames } from './basicControls.tsx';

// 「-- 請選擇 --」那一項的值
const NO_VALUE = '';
const OPEN_KEYS = ['ArrowDown', 'Enter', ' '];
const NAVIGATION_KEYS = ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'];

export interface SelectOption {
  value: string;
  label: string;
  /** 選項下方的提示小字 */
  hint?: string;
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /**
   * 沒有預設值的選單為 true：沒選時顯示「-- 請選擇 --」，列表最上方也能選回未選。
   * 有預設值、一定要有值的選單（例如主題、語言）為 false。
   */
  hasPlaceholder?: boolean;
  /** 必填卻沒選、或值不正確時紅框 */
  isInvalid?: boolean;
  ariaLabel?: string;
}

// ===== 元件 =====

/** 下拉選單；不會自動選第一項，預設值由各畫面決定。 */
export function Select({
  value,
  options,
  onChange,
  hasPlaceholder = false,
  isInvalid = false,
  ariaLabel,
}: SelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const allOptions = hasPlaceholder ? [placeholderOption(), ...options] : options;
  const control = useSelectControl(value, allOptions, onChange);
  const [isOpenUp, setIsOpenUp] = useState(false);

  useCloseOnOutsideClick(rootRef, control.isOpen, control.collapse);
  useOpenUpIfNoRoom(control.isOpen, rootRef, listRef, setIsOpenUp);
  useScrollHighlightedIntoView(control.isOpen, listRef, control.highlighted);

  const selected = options.find((option) => option.value === value);
  const isShowingPlaceholder = hasPlaceholder && !selected;
  return (
    <div
      ref={rootRef}
      className={joinClassNames(
        'platform-infrastructure-select',
        control.isOpen && 'is-open',
        isOpenUp && 'is-open-up',
        isInvalid && 'is-invalid',
      )}
    >
      <button
        ref={control.triggerRef}
        type="button"
        className={joinClassNames(
          'platform-infrastructure-select-trigger',
          isShowingPlaceholder && 'is-placeholder',
        )}
        aria-haspopup="listbox"
        aria-expanded={control.isOpen}
        aria-label={ariaLabel}
        onClick={control.toggle}
        onKeyDown={control.handleKeyDown}
      >
        {/* 值不在選項中時（例如設定裡的主題已被刪除）直接顯示值，讓使用者看得到目前的設定 */}
        {isShowingPlaceholder ? placeholderOption().label : (selected?.label ?? value)}
      </button>
      <ul ref={listRef} className="platform-infrastructure-select-list" role="listbox">
        {allOptions.map((option, index) => (
          <SelectOptionItem
            key={option.value}
            option={option}
            isSelected={option.value === value && option.value !== NO_VALUE}
            isHighlighted={index === control.highlighted}
            onChoose={() => control.choose(option)}
          />
        ))}
      </ul>
    </div>
  );
}

// ===== 選項 =====

interface SelectOptionItemProps {
  option: SelectOption;
  isSelected: boolean;
  isHighlighted: boolean;
  onChoose: () => void;
}

function SelectOptionItem({ option, isSelected, isHighlighted, onChoose }: SelectOptionItemProps) {
  return (
    <li
      role="option"
      aria-selected={isSelected}
      className={joinClassNames(
        'platform-infrastructure-select-option',
        isSelected && 'is-selected',
        isHighlighted && 'is-highlighted',
      )}
      onClick={onChoose}
    >
      {option.label}
      {option.hint && (
        <span className="platform-infrastructure-select-option-hint">{option.hint}</span>
      )}
    </li>
  );
}

// ===== 操作 =====

/** 選單的開合、目前反白的選項、選擇，以及 ↑↓、Enter、Esc 的鍵盤操作。 */
function useSelectControl(
  value: string,
  allOptions: SelectOption[],
  onChange: (value: string) => void,
) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const collapse = useCallback(() => setIsOpen(false), []);

  const open = () => {
    const selectedIndex = allOptions.findIndex((option) => option.value === value);
    setHighlighted(Math.max(0, selectedIndex));
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const choose = (option: SelectOption) => {
    close();
    if (option.value !== value) onChange(option.value);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!isOpen) {
      if (OPEN_KEYS.includes(event.key)) {
        event.preventDefault();
        open();
      }
      return;
    }
    if (!NAVIGATION_KEYS.includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowDown') setHighlighted(Math.min(highlighted + 1, allOptions.length - 1));
    if (event.key === 'ArrowUp') setHighlighted(Math.max(highlighted - 1, 0));
    if (event.key === 'Enter' && allOptions[highlighted]) choose(allOptions[highlighted]);
    if (event.key === 'Escape') {
      // 選單內按 Esc 只收合選單，不讓外層視窗收到
      event.stopPropagation();
      close();
    }
  };

  const toggle = () => (isOpen ? close() : open());

  return { triggerRef, isOpen, highlighted, collapse, choose, toggle, handleKeyDown };
}

// ===== 輔助 =====

function placeholderOption(): SelectOption {
  return { value: NO_VALUE, label: getText('PlatformInfrastructure.common.selectPlaceholder') };
}

/** 點選單以外的地方時收合。 */
function useCloseOnOutsideClick(
  rootRef: RefObject<HTMLDivElement | null>,
  isOpen: boolean,
  onOutsideClick: () => void,
): void {
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOutsideClick();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, rootRef, onOutsideClick]);
}

/** 列表超出會捲動的容器下緣、而上方空間比較大時，改成往上展開，避免被切掉。 */
function useOpenUpIfNoRoom(
  isOpen: boolean,
  rootRef: RefObject<HTMLDivElement | null>,
  listRef: RefObject<HTMLUListElement | null>,
  setIsOpenUp: (isOpenUp: boolean) => void,
): void {
  useLayoutEffect(() => {
    if (!isOpen || !rootRef.current || !listRef.current) {
      setIsOpenUp(false);
      return;
    }
    const container = findScrollContainer(rootRef.current);
    const bounds = container?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
    const rootRect = rootRef.current.getBoundingClientRect();
    const listHeight = listRef.current.getBoundingClientRect().height;
    const spaceBelow = bounds.bottom - rootRect.bottom;
    const spaceAbove = rootRect.top - bounds.top;
    setIsOpenUp(listHeight > spaceBelow && spaceAbove > spaceBelow);
  }, [isOpen, rootRef, listRef, setIsOpenUp]);
}

function useScrollHighlightedIntoView(
  isOpen: boolean,
  listRef: RefObject<HTMLUListElement | null>,
  highlighted: number,
): void {
  useEffect(() => {
    if (!isOpen) return;
    const option = listRef.current?.children[highlighted] as HTMLElement | undefined;
    // 測試環境（jsdom）沒有 scrollIntoView
    option?.scrollIntoView?.({ block: 'nearest' });
  }, [isOpen, listRef, highlighted]);
}

/** 往上找最近一個會捲動的容器；沒有就回傳 null（以整個視窗為準）。 */
function findScrollContainer(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node && node !== document.body) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}
