// 外殼：上方 navbar 切換核心模組、側邊欄切換子頁面、中間是內容區、最下方是 log 列，整個外殼有背景圖。

import './appShell.css';

import { useEffect, type MouseEvent } from 'react';

import { joinClassNames } from '../SharedComponents/index.ts';
import { getAssetUrl, getText } from '../ThemeAndLanguage/index.ts';
import { ContentErrorBoundary } from './ContentErrorBoundary.tsx';
import { navigateTo, useHashPath } from './hashRoute.ts';
import { LogBar } from './LogBar.tsx';
import {
  buildModulePath,
  buildPagePath,
  getHomePath,
  listModulesByPosition,
  resolveRoute,
  type ModuleRegistration,
  type ResolvedRoute,
} from './moduleRegistry.ts';

const MODULE_NAME = 'PlatformInfrastructure';
// 子頁面 2 個以上才顯示側邊欄（spec 規則）
const MIN_PAGES_FOR_SIDEBAR = 2;

// ===== 外殼 =====

/** 整個外殼；網址不存在時導回首頁。 */
export function AppShell() {
  const path = useHashPath();
  const route = resolveRoute(path);
  const homePath = getHomePath();

  useEffect(() => {
    if (!route && homePath) navigateTo(homePath, true);
  }, [route, homePath]);

  return (
    <div
      className="platform-infrastructure-shell"
      style={{ backgroundImage: `url(${getAssetUrl(MODULE_NAME, 'appBackground')})` }}
    >
      <Navbar route={route} />
      <div className="platform-infrastructure-body">
        {route && route.registration.pages.length >= MIN_PAGES_FOR_SIDEBAR && (
          <Sidebar route={route} />
        )}
        <main className="platform-infrastructure-content">
          {route && (
            <ContentErrorBoundary key={path} module={route.registration.module} pagePath={path}>
              <route.page.component />
            </ContentErrorBoundary>
          )}
        </main>
      </div>
      <LogBar />
    </div>
  );
}

// ===== Navbar =====

/** 最左側 logo（不能點），功能模組靠左，「平台設定」靠右；點模組切換到它的第一個子頁面。 */
function Navbar({ route }: { route: ResolvedRoute | null }) {
  const renderItem = (registration: ModuleRegistration) => (
    <ShellLink
      key={registration.path}
      className="platform-infrastructure-navbar-item"
      path={buildModulePath(registration)}
      isActive={route?.registration === registration}
    >
      {getText(registration.labelKey)}
    </ShellLink>
  );
  return (
    <header className="platform-infrastructure-navbar">
      <img
        className="platform-infrastructure-navbar-logo"
        src={getAssetUrl(MODULE_NAME, 'platformLogo')}
        alt={getText('PlatformInfrastructure.app.logoAlt')}
      />
      {listModulesByPosition('left').map(renderItem)}
      <span className="platform-infrastructure-navbar-spacer" />
      {listModulesByPosition('right').map(renderItem)}
    </header>
  );
}

// ===== 側邊欄 =====

/** 列出目前模組的子頁面，目前的標示選中。 */
function Sidebar({ route }: { route: ResolvedRoute }) {
  const { registration } = route;
  return (
    <nav className="platform-infrastructure-sidebar">
      <div className="platform-infrastructure-sidebar-header">
        {registration.eyebrowKey && (
          <div className="platform-infrastructure-eyebrow">{getText(registration.eyebrowKey)}</div>
        )}
        <div className="platform-infrastructure-sidebar-title">
          {getText(registration.labelKey)}
        </div>
      </div>
      {registration.pages.map((page) => (
        <ShellLink
          key={page.path}
          className="platform-infrastructure-sidebar-item"
          path={buildPagePath(registration, page)}
          isActive={route.page === page}
        >
          {getText(page.labelKey)}
        </ShellLink>
      ))}
    </nav>
  );
}

// ===== 輔助 =====

interface ShellLinkProps {
  className: string;
  path: string;
  isActive: boolean;
  children: string;
}

/** navbar 和側邊欄的連結：換頁一律經過 navigateTo，點目前所在的項目不動作。 */
function ShellLink({ className, path, isActive, children }: ShellLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (!isActive) navigateTo(path);
  };
  return (
    <a
      className={joinClassNames(className, isActive && 'is-active')}
      href={`#${path}`}
      aria-current={isActive ? 'page' : undefined}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
