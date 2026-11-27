// 設定子頁面共用的部分：頁首、讀取中、載入失敗、儲存列（儲存回饋依 conventions.md 第 9 段）。

import { useState } from 'react';

import type { PlatformError } from '../../../shared/PlatformInfrastructure/types.ts';
import {
  Button,
  EmptyState,
  ErrorMessage,
  joinClassNames,
  LoadingState,
  PageHero,
} from '../SharedComponents/index.ts';
import { getAssetUrl, getText } from '../ThemeAndLanguage/index.ts';

/** 儲存列的小字：成功為綠色，失敗為紅色；null 代表不顯示。 */
export type SaveFeedback = { text: string; tone: 'success' | 'danger' } | null;

const FEEDBACK_CLASSES = { success: 'is-success', danger: 'is-danger' } as const;
const MODULE_NAME = 'PlatformInfrastructure';

// ===== 頁首 =====

/** 一個設定子頁面的頁首內容：文字鍵與看板角色的素材名稱。 */
export interface SettingsHeroContent {
  displayKey: string;
  eyebrowKey: string;
  titleKey: string;
  descriptionKey: string;
  bannerAsset: string;
}

/** 設定子頁面的頁首：把文字鍵和素材名稱換成共用頁首要的文字與圖片位址。 */
export function SettingsHero({ content }: { content: SettingsHeroContent }) {
  return (
    <PageHero
      display={getText(content.displayKey)}
      eyebrow={getText(content.eyebrowKey)}
      title={getText(content.titleKey)}
      description={getText(content.descriptionKey)}
      bannerUrl={getAssetUrl(MODULE_NAME, content.bannerAsset)}
    />
  );
}

// ===== 讀取中、載入失敗 =====

/** 進入子頁面時的讀取中；頁首照常顯示。 */
export function LoadingCard() {
  return (
    <section className="platform-infrastructure-card">
      <LoadingState />
    </section>
  );
}

/** 進入時查詢失敗：空狀態「載入失敗」、錯誤訊息和「重試」按鈕。 */
export function LoadFailed({ error, onRetry }: { error: PlatformError; onRetry: () => void }) {
  const [isErrorVisible, setIsErrorVisible] = useState(true);
  return (
    <section className="platform-infrastructure-card">
      <EmptyState text={getText('PlatformInfrastructure.common.loadFailed')}>
        {isErrorVisible && <ErrorMessage error={error} onClose={() => setIsErrorVisible(false)} />}
        <Button onClick={onRetry}>{getText('PlatformInfrastructure.common.retry')}</Button>
      </EmptyState>
    </section>
  );
}

// ===== 儲存列 =====

interface SaveBarProps {
  feedback: SaveFeedback;
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
}

/** 儲存列：沒有修改時不能按；儲存中轉圈、不能重複按；結果以小字顯示在按鈕左邊。 */
export function SaveBar({ feedback, isDirty, isSaving, onSave }: SaveBarProps) {
  return (
    <div className="platform-infrastructure-save-bar">
      <span
        className={joinClassNames(
          'platform-infrastructure-feedback',
          feedback && FEEDBACK_CLASSES[feedback.tone],
        )}
        role="status"
      >
        {feedback?.text}
      </span>
      <Button
        onClick={onSave}
        isDisabled={!isDirty}
        isBusy={isSaving}
        busyLabel={getText('PlatformInfrastructure.common.saving')}
      >
        {getText('PlatformInfrastructure.common.save')}
      </Button>
    </div>
  );
}
