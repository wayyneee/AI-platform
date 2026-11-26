// API 串接頁：頁首 → 分頁「API key」「模型」（預設 API key）→ 分頁內容與儲存列。
// 有未儲存的修改時，切換分頁先詢問，確認後捨棄修改再切換。

import { useCallback, useEffect, useState } from 'react';

import type { ApiKeySummary, PlatformError } from '../../../shared/PlatformInfrastructure/types.ts';
import { listApiKeys } from '../ModelRegistry/index.ts';
import { confirmDiscardChanges, EmptyState, Tabs } from '../SharedComponents/index.ts';
import { toPlatformError } from '../SystemLog/index.ts';
import { getText } from '../ThemeAndLanguage/index.ts';
import { ApiKeyPanel } from './ApiKeyPanel.tsx';
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

  const load = useCallback(async () => {
    setLoadState({ status: 'loading' });
    try {
      setSavedKeys(await listApiKeys());
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
        <ApiTabs savedKeys={savedKeys} onSavedKeysChange={setSavedKeys} />
      )}
    </div>
  );
}

// ===== 分頁 =====

interface ApiTabsProps {
  savedKeys: ApiKeySummary[];
  onSavedKeysChange: (update: (keys: ApiKeySummary[]) => ApiKeySummary[]) => void;
}

/** 分頁標籤和目前分頁的內容；切換時分頁內容重建，未儲存的修改跟著捨棄。 */
function ApiTabs({ savedKeys, onSavedKeysChange }: ApiTabsProps) {
  const [activeTab, setActiveTab] = useState<ApiTab>('keys');
  const [isTabDirty, setIsTabDirty] = useState(false);

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
          onDirtyChange={setIsTabDirty}
        />
      )}
      {activeTab === 'models' && <ModelPanelComingSoon />}
    </div>
  );
}

/** 暫時的：模型分頁在第 6 段實作，先顯示「這個頁面還在製作中」，做好時換掉。 */
function ModelPanelComingSoon() {
  return (
    <section className="platform-infrastructure-card">
      <EmptyState text={getText('PlatformInfrastructure.common.comingSoon')} />
    </section>
  );
}
