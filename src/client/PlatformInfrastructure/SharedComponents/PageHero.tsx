// 頁首：子頁面最上方的橫幅，漸層底、點點、大型英文淡字、英文小標、標題與說明，看板角色在右邊破框。
// 所有模組的頁首都用這一個，換主題時一起換；文字和看板角色圖由使用的模組提供。

// 頁首的三顆四角星裝飾，位置在 sharedComponents.css 依順序決定
const SPARKLE_COUNT = 3;

export interface PageHeroProps {
  /** 大型英文淡字 */
  display: string;
  /** 標題上方的英文小標 */
  eyebrow: string;
  title: string;
  description: string;
  /** 看板角色圖的位址（使用的模組用 getAssetUrl 取得自己的素材） */
  bannerUrl: string;
}

/** 子頁面的頁首。 */
export function PageHero({ display, eyebrow, title, description, bannerUrl }: PageHeroProps) {
  return (
    <section className="platform-infrastructure-hero">
      <div className="platform-infrastructure-hero-decor">
        <span className="platform-infrastructure-display-text">{display}</span>
      </div>
      {Array.from({ length: SPARKLE_COUNT }, (_, index) => (
        <span key={index} className="platform-infrastructure-sparkle" />
      ))}
      <div className="platform-infrastructure-hero-title">
        <span className="platform-infrastructure-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <img className="platform-infrastructure-hero-character" src={bannerUrl} alt="" />
    </section>
  );
}
