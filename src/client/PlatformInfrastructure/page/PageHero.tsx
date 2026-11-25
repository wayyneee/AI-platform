// 設定子頁面的頁首：漸層底、點點、大型英文淡字、標題與說明，看板角色在右邊破框。

import { getAssetUrl, getText } from '../ThemeAndLanguage/index.ts';

const MODULE_NAME = 'PlatformInfrastructure';
// 頁首的三顆四角星裝飾，位置在 page.css 依順序決定
const SPARKLE_COUNT = 3;

/** 一個頁首要顯示的內容：文字鍵與看板角色的素材名稱。 */
export interface PageHeroContent {
  displayKey: string;
  eyebrowKey: string;
  titleKey: string;
  descriptionKey: string;
  bannerAsset: string;
}

/** 設定子頁面的頁首。 */
export function PageHero({ content }: { content: PageHeroContent }) {
  return (
    <section className="platform-infrastructure-hero">
      <div className="platform-infrastructure-hero-decor">
        <span className="platform-infrastructure-display-text">{getText(content.displayKey)}</span>
      </div>
      {Array.from({ length: SPARKLE_COUNT }, (_, index) => (
        <span key={index} className="platform-infrastructure-sparkle" />
      ))}
      <div className="platform-infrastructure-hero-title">
        <span className="platform-infrastructure-eyebrow">{getText(content.eyebrowKey)}</span>
        <h1>{getText(content.titleKey)}</h1>
        <p>{getText(content.descriptionKey)}</p>
      </div>
      <img
        className="platform-infrastructure-hero-character"
        src={getAssetUrl(MODULE_NAME, content.bannerAsset)}
        alt=""
      />
    </section>
  );
}
