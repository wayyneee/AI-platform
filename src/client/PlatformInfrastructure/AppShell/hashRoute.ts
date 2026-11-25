// 網址與換頁：網址的 # 後面是 /<模組>/<子頁面>，重新整理後停在同一頁。
// 換頁都經過這裡：有未儲存的修改時先詢問（含瀏覽器上一頁、下一頁），換頁後關閉所有彈出視窗。

import { useSyncExternalStore } from 'react';

import { closeAllModals } from '../SharedComponents/index.ts';
import { confirmLeaveIfNeeded, hasUnsavedChanges, installBeforeUnloadGuard } from './leaveGuard.ts';

const HASH_PREFIX = '#';

// 目前畫面停在的網址路徑；瀏覽器上一頁被攔下時，網址要改回這裡
let currentPath: string | null = null;
const pathListeners = new Set<() => void>();
let isHashListenerInstalled = false;

// ===== 讀取 =====

/** 目前網址 # 後面的路徑，例如 `/settings/basic`。 */
export function readHashPath(): string {
  return window.location.hash.replace(HASH_PREFIX, '');
}

/** 讀取目前的網址路徑，網址改變時（含瀏覽器上一頁）重新畫面。 */
export function useHashPath(): string {
  return useSyncExternalStore(subscribePathChange, readHashPath);
}

// ===== 換頁 =====

/** 使用者要換頁（navbar、側邊欄）：有未儲存的修改先詢問，確定離開才換。 */
export async function requestNavigation(path: string): Promise<void> {
  if (path === readHashPath()) return;
  if (await confirmLeaveIfNeeded()) navigateTo(path);
}

/**
 * 不詢問直接換頁；isReplace 為 true 時取代目前的瀏覽紀錄（例如網址不存在時導回首頁）。
 * 一般換頁用 requestNavigation。
 */
export function navigateTo(path: string, isReplace = false): void {
  if (path === readHashPath()) return;
  if (isReplace) window.location.replace(`${HASH_PREFIX}${path}`);
  else window.location.hash = path;
  // 網址已經改好才通知畫面；之後才到的 hashchange 看到路徑相同，就知道這次換頁已經同意過
  acceptPath(path);
}

// ===== 瀏覽器上一頁、下一頁、直接改網址 =====

/**
 * 網址已經被瀏覽器改掉了才會收到 hashchange，所以有未儲存的修改時先把網址改回原頁、再詢問；
 * 確定離開才換到新的網址。用 replaceState 改網址，不會多出一筆瀏覽紀錄，也不會再觸發 hashchange。
 */
async function handleHashChange(): Promise<void> {
  const targetPath = readHashPath();
  if (targetPath === currentPath) return;
  if (currentPath === null || !hasUnsavedChanges()) {
    acceptPath(targetPath);
    return;
  }
  const stayPath = currentPath;
  window.history.replaceState(null, '', `${HASH_PREFIX}${stayPath}`);
  notifyPathChange();
  if (!(await confirmLeaveIfNeeded())) return;
  // 詢問期間使用者可能已經用別的方式換頁，那就不再跳回這次要去的頁面
  if (currentPath !== stayPath) return;
  window.history.replaceState(null, '', `${HASH_PREFIX}${targetPath}`);
  acceptPath(targetPath);
}

// ===== 輔助 =====

/** 畫面換到新的路徑；換頁後關閉所有彈出視窗（page.md：換頁時外殼會關閉所有視窗）。 */
function acceptPath(path: string): void {
  const isChanged = currentPath !== null && currentPath !== path;
  currentPath = path;
  if (isChanged) closeAllModals();
  notifyPathChange();
}

function notifyPathChange(): void {
  pathListeners.forEach((listener) => listener());
}

/** 外殼第一次讀網址時，掛上 hashchange 和重新整理、關閉分頁的離開提示。 */
function subscribePathChange(onChange: () => void): () => void {
  if (!isHashListenerInstalled) {
    isHashListenerInstalled = true;
    window.addEventListener('hashchange', () => void handleHashChange());
    installBeforeUnloadGuard();
  }
  if (currentPath === null) currentPath = readHashPath();
  pathListeners.add(onChange);
  return () => pathListeners.delete(onChange);
}
