// 彈出視窗與確認視窗：視窗一個疊一個，Esc 和 X 只作用在最上面那一個；點背景不關閉。
// 有未儲存的修改時，關閉前先用固定的「尚未儲存」文字詢問（conventions.md 第 9 段）。

import { useEffect, type ReactNode } from 'react';

import { getText } from '../ThemeAndLanguage/index.ts';
import { Button } from './basicControls.tsx';
import { createExternalStore, useStoreValue } from './externalStore.ts';

/** 視窗內容用來控制視窗的方法。 */
export interface ModalControls {
  /** 不詢問直接關閉，例如儲存成功後 */
  close: () => void;
  /** 告訴視窗目前有沒有未儲存的修改；有的話按 X、Esc 或換頁時會先詢問 */
  setHasUnsavedChanges: (hasUnsavedChanges: boolean) => void;
}

export interface ModalOptions {
  title: ReactNode;
  /** 視窗內容；需要自己關閉視窗或回報未儲存的修改時，傳入函式取得 ModalControls */
  content: ReactNode | ((controls: ModalControls) => ReactNode);
}

/** showModal 回傳的控制把手：開啟視窗的那一方可以不詢問直接關閉它。 */
export interface ModalHandle {
  close: () => void;
}

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  /** 確認按鈕的文字；沒給時為「確認」 */
  confirmLabel?: string;
  /** 危險操作：確認按鈕用危險樣式 */
  isDanger?: boolean;
}

interface ModalEntry {
  id: number;
  title: ReactNode;
  body: ReactNode;
  footer?: ReactNode;
  /** 被 X、Esc 或 closeAllModals 關掉時呼叫，例如讓確認視窗回傳「沒有確認」 */
  onDismiss?: () => void;
  /** 開啟前的焦點，關閉後還給它，鍵盤操作才能接著用 */
  previousFocus: Element | null;
}

const modalStore = createExternalStore<ModalEntry[]>([]);
// 這兩個狀態不影響畫面，所以不放進 modalStore，改了不用重新畫
const unsavedModalIds = new Set<number>();
const askingToCloseIds = new Set<number>();
let nextModalId = 1;

// ===== 開啟 =====

/** 顯示彈出視窗；有未儲存的修改時，關閉前先詢問。 */
export function showModal(options: ModalOptions): ModalHandle {
  const id = nextModalId++;
  const controls: ModalControls = {
    close: () => removeModal(id),
    setHasUnsavedChanges: (hasUnsavedChanges) => {
      if (hasUnsavedChanges) unsavedModalIds.add(id);
      else unsavedModalIds.delete(id);
    },
  };
  const body = typeof options.content === 'function' ? options.content(controls) : options.content;
  addModal({ id, title: options.title, body });
  return { close: controls.close };
}

/**
 * 顯示確認視窗，回傳是否按了確認；按取消、X、Esc 都算沒有確認。
 * 焦點預設停在「取消」，避免誤按 Enter 執行危險操作。
 */
export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const id = nextModalId++;
    const finish = (isConfirmed: boolean) => {
      removeModal(id);
      resolve(isConfirmed);
    };
    const footer = (
      <>
        <Button variant="secondary" onClick={() => finish(false)} autoFocus>
          {getText('PlatformInfrastructure.common.cancel')}
        </Button>
        <Button variant={options.isDanger ? 'danger' : 'primary'} onClick={() => finish(true)}>
          {options.confirmLabel ?? getText('PlatformInfrastructure.common.confirm')}
        </Button>
      </>
    );
    addModal({
      id,
      title: options.title,
      body: options.message,
      footer,
      onDismiss: () => resolve(false),
    });
  });
}

/** 詢問要不要捨棄未儲存的修改，文字全平台一致；回傳是否確定離開。 */
export function confirmDiscardChanges(): Promise<boolean> {
  return showConfirm({
    title: getText('PlatformInfrastructure.leaveConfirm.title'),
    message: getText('PlatformInfrastructure.leaveConfirm.message'),
    confirmLabel: getText('PlatformInfrastructure.leaveConfirm.confirm'),
    isDanger: true,
  });
}

// ===== 關閉 =====

/** 不經確認關閉所有視窗；由外殼在換頁後呼叫。開著的確認視窗都算沒有確認。 */
export function closeAllModals(): void {
  const entries = modalStore.get();
  if (entries.length === 0) return;
  unsavedModalIds.clear();
  askingToCloseIds.clear();
  modalStore.set([]);
  entries.forEach((entry) => entry.onDismiss?.());
}

/** 是否有開著、而且有未儲存修改的視窗；外殼換頁前用它決定要不要詢問。 */
export function hasUnsavedModal(): boolean {
  return modalStore.get().some((entry) => unsavedModalIds.has(entry.id));
}

/** 使用者按 X 或 Esc：有未儲存的修改先詢問，詢問中再按不會跳出第二個確認視窗。 */
async function requestCloseModal(id: number): Promise<void> {
  if (askingToCloseIds.has(id)) return;
  if (!unsavedModalIds.has(id)) {
    dismissModal(id);
    return;
  }
  askingToCloseIds.add(id);
  const isConfirmed = await confirmDiscardChanges();
  askingToCloseIds.delete(id);
  if (isConfirmed) dismissModal(id);
}

// ===== 畫面 =====

/** 畫出所有開著的視窗，後開的疊在上面；由外殼放在畫面最外層。 */
export function ModalStack() {
  const entries = useStoreValue(modalStore);
  useCloseTopModalOnEscape(entries);
  return (
    <>
      {entries.map((entry) => (
        <ModalFrame key={entry.id} entry={entry} />
      ))}
    </>
  );
}

/** 一個視窗：標題和 X、內容、選填的按鈕列。背景不掛點擊事件，所以點背景不關閉。 */
function ModalFrame({ entry }: { entry: ModalEntry }) {
  const titleId = `platform-infrastructure-modal-title-${entry.id}`;
  return (
    <div className="platform-infrastructure-backdrop">
      <div
        className="platform-infrastructure-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="platform-infrastructure-modal-header">
          <h2 className="platform-infrastructure-modal-title" id={titleId}>
            {entry.title}
          </h2>
          <button
            type="button"
            className="platform-infrastructure-icon-button"
            aria-label={getText('PlatformInfrastructure.common.close')}
            onClick={() => void requestCloseModal(entry.id)}
          >
            ×
          </button>
        </div>
        <div className="platform-infrastructure-modal-body">{entry.body}</div>
        {entry.footer && <div className="platform-infrastructure-modal-footer">{entry.footer}</div>}
      </div>
    </div>
  );
}

/**
 * Esc 只作用在最上面的視窗。
 * 掛在 document 的冒泡階段：視窗裡的下拉選單按 Esc 時會擋下事件，只收合選單。
 */
function useCloseTopModalOnEscape(entries: ModalEntry[]): void {
  useEffect(() => {
    const topModal = entries.at(-1);
    if (!topModal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void requestCloseModal(topModal.id);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [entries]);
}

// ===== 輔助 =====

function addModal(entry: Omit<ModalEntry, 'previousFocus'>): void {
  modalStore.set([...modalStore.get(), { ...entry, previousFocus: document.activeElement }]);
}

/** 移除視窗並把焦點還給開啟前的元素；已經關掉的視窗不再處理。 */
function removeModal(id: number): ModalEntry | undefined {
  const entry = modalStore.get().find((candidate) => candidate.id === id);
  if (!entry) return undefined;
  unsavedModalIds.delete(id);
  askingToCloseIds.delete(id);
  modalStore.set(modalStore.get().filter((candidate) => candidate.id !== id));
  if (entry.previousFocus instanceof HTMLElement) entry.previousFocus.focus();
  return entry;
}

function dismissModal(id: number): void {
  removeModal(id)?.onDismiss?.();
}
