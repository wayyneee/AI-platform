// 主題的套用與素材位址：載入主題的 theme.css（失敗時改用 default），並依目前主題組出素材的位址。

import { DEFAULT_THEME } from '../../../shared/PlatformInfrastructure/types.ts';
import { createError, defineErrorCodes, writeLog } from '../SystemLog/index.ts';

const MODULE_NAME = 'PlatformInfrastructure';
// 主題放在 public/theme/<主題>/，前端從網站根目錄的 /theme/ 取得
const THEME_ROOT_URL = '/theme';
const THEME_STYLE_FILE = 'theme.css';
const CSS_CONTENT_TYPE = 'text/css';
// 素材的檔名是「素材名稱.png」，放在 public/theme/<主題>/<Module>/
const ASSET_EXTENSION = '.png';
const THEME_LINK_ID = 'platform-infrastructure-theme';

export const ThemeErrorCodes = defineErrorCodes({
  THEME_LOAD_FAILED: 'warning',
});

/** 載入某個主題的 theme.css；成功回傳 true。 */
export type ThemeStyleLoader = (theme: string) => Promise<boolean>;

let activeTheme = DEFAULT_THEME;

// ===== 套用主題 =====

/**
 * 套用主題，回傳實際套用的主題名稱。
 * 主題載入失敗時寫一筆警告並改用 default，畫面照常顯示（spec 規則）。
 */
export async function applyTheme(
  theme: string,
  loadStyle: ThemeStyleLoader = loadThemeStyle,
): Promise<string> {
  if (await loadStyle(theme)) {
    setActiveTheme(theme);
    return theme;
  }

  reportThemeLoadFailed(theme);
  setActiveTheme(DEFAULT_THEME);
  if (theme !== DEFAULT_THEME) await loadStyle(DEFAULT_THEME);
  return DEFAULT_THEME;
}

/** 記住目前的主題，素材位址依它組出。 */
export function setActiveTheme(theme: string): void {
  activeTheme = theme;
}

// ===== 素材位址 =====

/** 依目前主題取得某個模組素材的位址；各模組只用素材名稱引用，換主題時素材跟著換。 */
export function getAssetUrl(module: string, assetName: string): string {
  return `${themeUrl(activeTheme)}/${module}/${assetName}${ASSET_EXTENSION}`;
}

// ===== 輔助 =====

/** 確認主題的樣式表存在後加到頁面上，等它載入完成；不存在或載入失敗時回傳 false。 */
async function loadThemeStyle(theme: string): Promise<boolean> {
  const url = themeStyleUrl(theme);
  if (!(await isThemeStyleAvailable(url))) return false;
  return insertStyleLink(url);
}

/**
 * 確認位址上真的是 CSS 檔。
 * 不能只看 <link> 的 load 事件：開發伺服器找不到檔案時會回傳首頁（HTTP 200、text/html），link 照樣觸發 load。
 */
export async function isThemeStyleAvailable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    const contentType = response.headers.get('content-type') ?? '';
    return response.ok && contentType.includes(CSS_CONTENT_TYPE);
  } catch {
    return false;
  }
}

function insertStyleLink(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    document.getElementById(THEME_LINK_ID)?.remove();
    const link = document.createElement('link');
    link.id = THEME_LINK_ID;
    link.rel = 'stylesheet';
    link.href = url;
    link.onload = () => resolve(true);
    link.onerror = () => {
      link.remove();
      resolve(false);
    };
    // 主題的變數要排在各模組的樣式前面，模組的樣式才會用到它
    document.head.prepend(link);
  });
}

function reportThemeLoadFailed(theme: string): void {
  const error = createError(
    MODULE_NAME,
    'applyTheme',
    ThemeErrorCodes.THEME_LOAD_FAILED,
    `主題「${theme}」的 ${THEME_STYLE_FILE} 載入失敗，改用 ${DEFAULT_THEME}`,
    { theme, url: themeStyleUrl(theme) },
  );
  writeLog({ level: 'warning', module: MODULE_NAME, action: `套用主題：${theme}`, error });
}

function themeUrl(theme: string): string {
  return `${THEME_ROOT_URL}/${encodeURIComponent(theme)}`;
}

function themeStyleUrl(theme: string): string {
  return `${themeUrl(theme)}/${THEME_STYLE_FILE}`;
}
