// 回饋類元件：讀取中、空狀態（預設插圖＋文字＋選填的按鈕）、錯誤訊息（白話說明＋來源）。

import type { ReactNode } from 'react';

import type { PlatformError } from '../../../shared/PlatformInfrastructure/types.ts';
import { getAssetUrl, getText } from '../ThemeAndLanguage/index.ts';

const MODULE_NAME = 'PlatformInfrastructure';
const EMPTY_STATE_ASSET = 'emptyStateIllustration';

// ===== 讀取中 =====

export interface LoadingStateProps {
  /** 沒給時顯示「讀取中…」 */
  text?: string;
}

/** 讀取中：大的轉圈和文字。 */
export function LoadingState({ text }: LoadingStateProps) {
  return (
    <div className="platform-infrastructure-loading" role="status">
      <span className="platform-infrastructure-spinner platform-infrastructure-spinner-large" />
      <span>{text ?? getText('PlatformInfrastructure.common.loading')}</span>
    </div>
  );
}

// ===== 空狀態 =====

export interface EmptyStateProps {
  text: string;
  /** 插圖和文字下方的內容，例如錯誤訊息、「重試」按鈕 */
  children?: ReactNode;
}

/** 空狀態：預設插圖＋文字＋選填的內容。 */
export function EmptyState({ text, children }: EmptyStateProps) {
  return (
    <div className="platform-infrastructure-empty">
      <img
        className="platform-infrastructure-empty-image"
        src={getAssetUrl(MODULE_NAME, EMPTY_STATE_ASSET)}
        alt=""
      />
      <p className="platform-infrastructure-empty-text">{text}</p>
      {children}
    </div>
  );
}

// ===== 錯誤訊息 =====

export interface ErrorMessageProps {
  error: PlatformError;
  /** 有給才顯示 X */
  onClose?: () => void;
}

/**
 * 錯誤訊息：第一行為白話說明，第二行為「模組／介面（代碼：…）」。
 * 不顯示訊息和細節：那是寫給開發者看的，在 log 裡查得到（conventions.md 第 9 段）。
 */
export function ErrorMessage({ error, onClose }: ErrorMessageProps) {
  return (
    <div className="platform-infrastructure-error-message" role="alert">
      <span className="platform-infrastructure-error-message-icon">!</span>
      <div className="platform-infrastructure-error-message-body">
        <div className="platform-infrastructure-error-message-title">
          {getText(`errors.${error.code}`)}
        </div>
        <div className="platform-infrastructure-error-message-source">
          {describeErrorSource(error)}
        </div>
      </div>
      {onClose && (
        <button
          type="button"
          className="platform-infrastructure-icon-button"
          aria-label={getText('PlatformInfrastructure.common.close')}
          onClick={onClose}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** 錯誤的來源文字：「模組／介面（代碼：…）」。 */
export function describeErrorSource(error: PlatformError): string {
  return getText('PlatformInfrastructure.common.errorSource', {
    module: error.module,
    interfaceName: error.interfaceName,
    code: error.code,
  });
}
