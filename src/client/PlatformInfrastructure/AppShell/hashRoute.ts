// 網址與換頁：網址的 # 後面是 /<模組>/<子頁面>，重新整理後停在同一頁；換頁都經過 navigateTo。

import { useSyncExternalStore } from 'react';

const HASH_PREFIX = '#';

/** 目前網址 # 後面的路徑，例如 `/settings/basic`。 */
export function readHashPath(): string {
  return window.location.hash.replace(HASH_PREFIX, '');
}

/** 換到某個網址路徑；isReplace 為 true 時取代目前的瀏覽紀錄（例如網址不存在時導回首頁）。 */
export function navigateTo(path: string, isReplace = false): void {
  if (path === readHashPath()) return;
  if (isReplace) {
    window.location.replace(`${HASH_PREFIX}${path}`);
    return;
  }
  window.location.hash = path;
}

/** 讀取目前的網址路徑，網址改變時（含瀏覽器上一頁）重新畫面。 */
export function useHashPath(): string {
  return useSyncExternalStore(subscribeHashChange, readHashPath);
}

function subscribeHashChange(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}
