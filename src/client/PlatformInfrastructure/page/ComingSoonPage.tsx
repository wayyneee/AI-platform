// 暫時的頁面：API 串接、花費統計在之後的分段實作，先顯示頁首和「這個頁面還在製作中」；做好時刪除這個檔案。

import { EmptyState } from '../SharedComponents/index.ts';
import { getText } from '../ThemeAndLanguage/index.ts';
import { PageHero, type PageHeroContent } from './PageHero.tsx';

const API_SETTINGS_HERO: PageHeroContent = {
  displayKey: 'PlatformInfrastructure.apiSettings.display',
  eyebrowKey: 'PlatformInfrastructure.apiSettings.eyebrow',
  titleKey: 'PlatformInfrastructure.apiSettings.title',
  descriptionKey: 'PlatformInfrastructure.apiSettings.description',
  bannerAsset: 'apiSettingsBanner',
};

const USAGE_STATS_HERO: PageHeroContent = {
  displayKey: 'PlatformInfrastructure.usageStats.display',
  eyebrowKey: 'PlatformInfrastructure.usageStats.eyebrow',
  titleKey: 'PlatformInfrastructure.usageStats.title',
  descriptionKey: 'PlatformInfrastructure.usageStats.description',
  bannerAsset: 'usageStatsBanner',
};

function ComingSoonPage({ hero }: { hero: PageHeroContent }) {
  return (
    <div className="platform-infrastructure-page">
      <PageHero content={hero} />
      <section className="platform-infrastructure-card">
        <EmptyState text={getText('PlatformInfrastructure.common.comingSoon')} />
      </section>
    </div>
  );
}

/** API 串接（暫時）。 */
export function ApiSettingsComingSoon() {
  return <ComingSoonPage hero={API_SETTINGS_HERO} />;
}

/** 花費統計（暫時）。 */
export function UsageStatsComingSoon() {
  return <ComingSoonPage hero={USAGE_STATS_HERO} />;
}
