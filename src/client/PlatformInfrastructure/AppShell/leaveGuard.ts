// 未儲存離開確認：頁面用 useLeaveGuard 回報有沒有未儲存的修改，外殼在換頁、瀏覽器上一頁、重新整理或關閉分頁前先詢問。
// 開著、有未儲存修改的彈出視窗也算（例如新增模型視窗），確定離開後外殼會一併關閉視窗。

import { useEffect } from 'react';

import { confirmDiscardChanges, hasUnsavedModal } from '../SharedComponents/index.ts';

// 每個有未儲存修改的頁面放一個記號；頁面離開畫面時拿掉
const unsavedPageMarks = new Set<object>();
let isAskingToLeave = false;
let isBeforeUnloadInstalled = false;

// ===== 頁面回報 =====

/** 有未儲存的修改時，離開這個頁面前先跳出確認；改回原樣時傳 false 就不再詢問。 */
export function useLeaveGuard(hasUnsavedChanges: boolean): void {
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const mark = {};
    unsavedPageMarks.add(mark);
    return () => {
      unsavedPageMarks.delete(mark);
    };
  }, [hasUnsavedChanges]);
}

// ===== 外殼詢問 =====

/** 目前有沒有未儲存的修改：任何一個頁面，或開著的彈出視窗。 */
export function hasUnsavedChanges(): boolean {
  return unsavedPageMarks.size > 0 || hasUnsavedModal();
}

/**
 * 要離開時呼叫：沒有未儲存的修改直接回傳 true；有的話詢問，回傳是否確定離開。
 * 詢問中又有人要離開（例如連按兩次上一頁）時不再跳第二個確認視窗，直接回傳 false。
 */
export async function confirmLeaveIfNeeded(): Promise<boolean> {
  if (!hasUnsavedChanges()) return true;
  if (isAskingToLeave) return false;
  isAskingToLeave = true;
  try {
    return await confirmDiscardChanges();
  } finally {
    isAskingToLeave = false;
  }
}

// ===== 重新整理、關閉分頁 =====

/**
 * 有未儲存的修改時，重新整理或關閉分頁會出現瀏覽器自己的離開提示（瀏覽器不讓網頁換成自己的視窗）。
 * 外殼開始追蹤網址時掛上一次。
 */
export function installBeforeUnloadGuard(): void {
  if (isBeforeUnloadInstalled) return;
  isBeforeUnloadInstalled = true;
  window.addEventListener('beforeunload', (event) => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    // 舊版瀏覽器要設 returnValue 才會出現提示
    event.returnValue = '';
  });
}
