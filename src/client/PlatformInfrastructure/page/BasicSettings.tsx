// 基礎設定頁：選擇主題、語言；儲存後顯示「已儲存，即將重新整理套用」，1.5 秒後重新整理頁面套用。
// 有未儲存的修改時，離開前由外殼詢問。

import { useCallback, useEffect, useState } from 'react';

import type {
  PlatformError,
  PlatformSettings,
  SettingOptions,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { useLeaveGuard } from '../AppShell/index.ts';
import {
  Button,
  EmptyState,
  ErrorMessage,
  joinClassNames,
  LoadingState,
  Select,
  showError,
} from '../SharedComponents/index.ts';
import { toPlatformError } from '../SystemLog/index.ts';
import {
  getSettings,
  getText,
  listSettingOptions,
  updateSettings,
} from '../ThemeAndLanguage/index.ts';
import { PageHero, type PageHeroContent } from './PageHero.tsx';

const MODULE_NAME = 'PlatformInfrastructure';
// page.md：儲存成功後 1.5 秒重新整理頁面
const RELOAD_DELAY_MS = 1500;

const HERO: PageHeroContent = {
  displayKey: 'PlatformInfrastructure.basicSettings.display',
  eyebrowKey: 'PlatformInfrastructure.basicSettings.eyebrow',
  titleKey: 'PlatformInfrastructure.basicSettings.title',
  descriptionKey: 'PlatformInfrastructure.basicSettings.description',
  bannerAsset: 'basicSettingsBanner',
};

type LoadState =
  | { status: 'loading' }
  | { status: 'failed'; error: PlatformError }
  | { status: 'ready'; saved: PlatformSettings; options: SettingOptions };

type SaveState =
  { status: 'idle' } | { status: 'saving' } | { status: 'saved' } | { status: 'failed' };

// ===== 頁面 =====

/** 基礎設定頁。 */
export function BasicSettings() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(async () => {
    setLoadState({ status: 'loading' });
    try {
      const [saved, options] = await Promise.all([getSettings(), listSettingOptions()]);
      setLoadState({ status: 'ready', saved, options });
    } catch (error) {
      setLoadState({ status: 'failed', error: toPlatformError(error, MODULE_NAME, 'getSettings') });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="platform-infrastructure-page">
      <PageHero content={HERO} />
      {loadState.status === 'loading' && (
        <section className="platform-infrastructure-card">
          <LoadingState />
        </section>
      )}
      {loadState.status === 'failed' && <LoadFailed error={loadState.error} onRetry={load} />}
      {loadState.status === 'ready' && (
        <SettingsForm initial={loadState.saved} options={loadState.options} />
      )}
    </div>
  );
}

// ===== 設定表單 =====

interface SettingsFormProps {
  initial: PlatformSettings;
  options: SettingOptions;
}

/** 主題、語言選單和儲存列；目前的內容和上次儲存時不同，才算有未儲存的修改。 */
function SettingsForm({ initial, options }: SettingsFormProps) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });

  // 改回原樣就不算未儲存的修改（conventions.md 第 9 段）
  const isDirty = draft.theme !== saved.theme || draft.language !== saved.language;
  useLeaveGuard(isDirty);

  const changeDraft = (changes: Partial<PlatformSettings>) => {
    setDraft({ ...draft, ...changes });
    setSaveState({ status: 'idle' });
  };

  const save = async () => {
    setSaveState({ status: 'saving' });
    try {
      const result = await updateSettings(draft);
      setSaved(result);
      setDraft(result);
      setSaveState({ status: 'saved' });
      // 主題、語言要重新整理才生效（spec 規則）
      window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
    } catch (thrown) {
      // 失敗時紅色小字只寫「儲存失敗」，白話說明和來源由錯誤訊息顯示，避免同一句話出現兩次
      setSaveState({ status: 'failed' });
      showError(toPlatformError(thrown, MODULE_NAME, 'updateSettings'));
    }
  };

  return (
    <div className="platform-infrastructure-stack">
      <section className="platform-infrastructure-card">
        <h2 className="platform-infrastructure-card-title">
          {getText('PlatformInfrastructure.basicSettings.cardTitle')}
          <span className="platform-infrastructure-eyebrow">
            {getText('PlatformInfrastructure.basicSettings.cardEyebrow')}
          </span>
        </h2>
        <SettingField
          label={getText('PlatformInfrastructure.basicSettings.theme')}
          hint={getText('PlatformInfrastructure.basicSettings.themeHint')}
          value={draft.theme}
          options={options.themes.map((theme) => ({ value: theme, label: theme }))}
          onChange={(theme) => changeDraft({ theme })}
        />
        <SettingField
          label={getText('PlatformInfrastructure.basicSettings.language')}
          hint={getText('PlatformInfrastructure.basicSettings.languageHint')}
          value={draft.language}
          options={options.languages.map((language) => ({
            value: language,
            label: getText(`PlatformInfrastructure.language.${language}`),
          }))}
          onChange={(language) => changeDraft({ language })}
        />
      </section>
      <SaveBar saveState={saveState} isDirty={isDirty} onSave={save} />
    </div>
  );
}

interface SettingFieldProps {
  label: string;
  hint: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

/** 一個設定欄位：左邊名稱，右邊選單和提示。主題、語言一定要有值，沒有「-- 請選擇 --」。 */
function SettingField({ label, hint, value, options, onChange }: SettingFieldProps) {
  return (
    <div className="platform-infrastructure-field">
      <div className="platform-infrastructure-field-label">{label}</div>
      <div className="platform-infrastructure-field-control">
        <Select value={value} options={options} onChange={onChange} ariaLabel={label} />
        <div className="platform-infrastructure-hint">{hint}</div>
      </div>
    </div>
  );
}

// ===== 儲存列 =====

interface SaveBarProps {
  saveState: SaveState;
  isDirty: boolean;
  onSave: () => void;
}

/** 儲存列：沒有修改時不能按；儲存中轉圈；成功綠色小字，失敗紅色小字（conventions.md 第 9 段）。 */
function SaveBar({ saveState, isDirty, onSave }: SaveBarProps) {
  const feedback = describeSaveFeedback(saveState);
  return (
    <div className="platform-infrastructure-save-bar">
      <span
        className={joinClassNames('platform-infrastructure-feedback', feedback?.className)}
        role="status"
      >
        {feedback?.text}
      </span>
      <Button
        onClick={onSave}
        isDisabled={!isDirty}
        isBusy={saveState.status === 'saving'}
        busyLabel={getText('PlatformInfrastructure.common.saving')}
      >
        {getText('PlatformInfrastructure.common.save')}
      </Button>
    </div>
  );
}

function describeSaveFeedback(saveState: SaveState): { text: string; className: string } | null {
  if (saveState.status === 'saved') {
    return { text: getText('PlatformInfrastructure.basicSettings.saved'), className: 'is-success' };
  }
  if (saveState.status === 'failed') {
    return { text: getText('PlatformInfrastructure.common.saveFailed'), className: 'is-danger' };
  }
  return null;
}

// ===== 載入失敗 =====

/** 進入時查詢失敗：空狀態「載入失敗」、錯誤訊息和「重試」按鈕。 */
function LoadFailed({ error, onRetry }: { error: PlatformError; onRetry: () => void }) {
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
