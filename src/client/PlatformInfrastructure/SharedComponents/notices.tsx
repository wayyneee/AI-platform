// 畫面右上角的提示區：提示訊息（showToast，會自己消失）和錯誤訊息（showError，要按 X 才關閉），最多同時 5 則。

import type { PlatformError } from '../../../shared/PlatformInfrastructure/types.ts';
import { joinClassNames } from './basicControls.tsx';
import { createExternalStore, useStoreValue } from './externalStore.ts';
import { ErrorMessage } from './feedback.tsx';

export type ToastType = 'success' | 'info' | 'warning';

// page.md：最多同時 5 則；成功、一般 3 秒後消失，警告 5 秒後消失
export const NOTICE_LIMIT = 5;
export const TOAST_DURATIONS_MS: Record<ToastType, number> = {
  success: 3000,
  info: 3000,
  warning: 5000,
};

type Notice =
  | { id: number; kind: 'toast'; type: ToastType; text: string }
  | { id: number; kind: 'error'; error: PlatformError };

const noticeStore = createExternalStore<Notice[]>([]);
let nextNoticeId = 1;

// ===== 顯示 =====

/** 顯示提示訊息，時間到自己消失。 */
export function showToast(type: ToastType, text: string): void {
  const id = nextNoticeId++;
  addNotice({ id, kind: 'toast', type, text });
  window.setTimeout(() => removeNotice(id), TOAST_DURATIONS_MS[type]);
}

/** 顯示錯誤訊息：第一行白話說明、第二行「模組／介面（代碼：…）」；不會自動消失，要按 X。 */
export function showError(error: PlatformError): void {
  addNotice({ id: nextNoticeId++, kind: 'error', error });
}

// ===== 畫面 =====

/** 提示區；由外殼放在畫面最外層。 */
export function NoticeArea() {
  const notices = useStoreValue(noticeStore);
  if (notices.length === 0) return null;
  return (
    <div className="platform-infrastructure-toast-area">
      {notices.map((notice) =>
        notice.kind === 'toast' ? (
          <div
            key={notice.id}
            className={joinClassNames('platform-infrastructure-toast', `is-${notice.type}`)}
            role="status"
          >
            {notice.text}
          </div>
        ) : (
          <ErrorMessage
            key={notice.id}
            error={notice.error}
            onClose={() => removeNotice(notice.id)}
          />
        ),
      )}
    </div>
  );
}

// ===== 輔助 =====

/** 加在最下面；超過上限時把最舊的拿掉。 */
function addNotice(notice: Notice): void {
  noticeStore.set([...noticeStore.get(), notice].slice(-NOTICE_LIMIT));
}

function removeNotice(id: number): void {
  noticeStore.set(noticeStore.get().filter((notice) => notice.id !== id));
}
