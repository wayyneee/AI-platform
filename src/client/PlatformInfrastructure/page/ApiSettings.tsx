// API 串接頁：頁首 → 分頁「API key」「模型」（預設 API key）→ 分頁內容與儲存列。
// 有未儲存的修改時，切換分頁先詢問，確認後捨棄修改再切換。

import { useCallback, useEffect, useState } from 'react';

import type {
  ApiKeySummary,
  PlatformError,
  SavedModel,
} from '../../../shared/PlatformInfrastructure/types.ts';
import { listApiKeys, listModels } from '../ModelRegistry/index.ts';
import { confirmDiscardChanges, Tabs } from '../SharedComponents/index.ts';
import { toPlatformError } from '../SystemLog/index.ts';
import { getText } from '../ThemeAndLanguage/index.ts';
import { ApiKeyPanel } from './ApiKeyPanel.tsx';
import { ModelPanel, type ModelsUpdate } from './ModelPanel.tsx';
import { PageHero, type PageHeroContent } from './PageHero.tsx';
import { LoadFailed, LoadingCard } from './settingsPageParts.tsx';

const MODULE_NAME = 'PlatformInfrastructure';

const HERO: PageHeroContent = {
  displayKey: 'PlatformInfrastructure.apiSettings.display',
  eyebrowKey: 'PlatformInfrastructure.apiSettings.eyebrow',
  titleKey: 'PlatformInfrastructure.apiSettings.title',
  descriptionKey: 'PlatformInfrastructure.apiSettings.description',
  bannerAsset: 'apiSettingsBanner',
};

type ApiTab = 'keys' | 'models';

type LoadState =
  { status: 'loading' } | { status: 'failed'; error: PlatformError } | { status: 'ready' };

// ===== 頁面 =====

/** API 串接頁。 */
export function ApiSettings() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [savedKeys, setSavedKeys] = useState<ApiKeySummary[]>([]);
  const [models, setModels] = useState<SavedModel[]>([]);

  const load = useCallback(async () => {
    setLoadState({ status: 'loading' });
    try {
      const [keys, loadedModels] = await Promise.all([listApiKeys(), listModels()]);
      setSavedKeys(keys);
      setModels(loadedModels);
      setLoadState({ status: 'ready' });
    } catch (error) {
      setLoadState({ status: 'failed', error: toPlatformError(error, MODULE_NAME, 'listApiKeys') });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="platform-infrastructure-page">
      <PageHero content={HERO} />
      {loadState.status === 'loading' && <LoadingCard />}
      {loadState.status === 'failed' && <LoadFailed error={loadState.error} onRetry={load} />}
      {loadState.status === 'ready' && (
        <ApiTabs
          savedKeys={savedKeys}
          onSavedKeysChange={setSavedKeys}
          models={models}
          onModelsChange={setModels}
        />
      )}
    </div>
  );
}

// ===== 分頁 =====

interface ApiTabsProps {
  savedKeys: ApiKeySummary[];
  onSavedKeysChange: (update: (keys: ApiKeySummary[]) => ApiKeySummary[]) => void;
  models: SavedModel[];
  onModelsChange: (update: ModelsUpdate) => void;
}

/** 分頁標籤和目前分頁的內容；切換時分頁內容重建，未儲存的修改跟著捨棄。 */
function ApiTabs({ savedKeys, onSavedKeysChange, models, onModelsChange }: ApiTabsProps) {
  const [activeTab, setActiveTab] = useState<ApiTab>('keys');
  const [isTabDirty, setIsTabDirty] = useState(false);

  // 刪除 key 時，後端已把選用它的模型 key 欄位清空；畫面跟著清空，模型分頁才會紅框提示
  const clearDeletedKey = useCallback(
    (keyId: string) =>
      onModelsChange((current) =>
        current.map((model) => (model.keyId === keyId ? { ...model, keyId: null } : model)),
      ),
    [onModelsChange],
  );

  const switchTab = async (tab: ApiTab) => {
    if (tab === activeTab) return;
    if (isTabDirty && !(await confirmDiscardChanges())) return;
    setIsTabDirty(false);
    setActiveTab(tab);
  };

  return (
    <div className="platform-infrastructure-stack">
      <div className="platform-infrastructure-page-tabs">
        <Tabs
          items={[
            { value: 'keys', label: getText('PlatformInfrastructure.apiSettings.tabKeys') },
            { value: 'models', label: getText('PlatformInfrastructure.apiSettings.tabModels') },
          ]}
          value={activeTab}
          onChange={(tab) => void switchTab(tab)}
        />
      </div>
      {activeTab === 'keys' && (
        <ApiKeyPanel
          savedKeys={savedKeys}
          onSavedKeysChange={onSavedKeysChange}
          models={models}
          onKeyDeleted={clearDeletedKey}
          onDirtyChange={setIsTabDirty}
        />
      )}
      {activeTab === 'models' && (
        <ModelPanel
          savedKeys={savedKeys}
          models={models}
          onModelsChange={onModelsChange}
          onDirtyChange={setIsTabDirty}
        />
      )}
    </div>
  );
}
