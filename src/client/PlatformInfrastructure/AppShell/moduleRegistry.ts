// 模組登記：各核心模組的 navbar 資訊和子頁面，由前端進入點登記；網址怎麼對應到模組和子頁面也在這裡決定。

import type { ComponentType } from 'react';

/** 一個子頁面的登記資訊。 */
export interface PageRegistration {
  /** 網址中的子頁面路徑，例如 `basic` */
  path: string;
  /** 側邊欄顯示的名稱（文字鍵） */
  labelKey: string;
  component: ComponentType;
}

/** 一個核心模組的登記資訊，由各模組的 `getModuleRegistration` 提供。 */
export interface ModuleRegistration {
  /** 核心模組名稱，例如 `PlatformInfrastructure`；頁面出錯時標明來源 */
  module: string;
  /** 網址中的模組路徑，例如 `settings` */
  path: string;
  /** navbar 顯示的名稱（文字鍵） */
  labelKey: string;
  /** 側邊欄標題上方的英文小標（文字鍵），選填 */
  eyebrowKey?: string;
  /** 功能模組放左邊；「平台設定」放右邊，和功能模組分開 */
  position: 'left' | 'right';
  /** 子頁面，第一個是點 navbar 時進入的頁面；2 個以上才顯示側邊欄 */
  pages: PageRegistration[];
}

/** 網址對應到的模組和子頁面。 */
export interface ResolvedRoute {
  registration: ModuleRegistration;
  page: PageRegistration;
}

const registrations: ModuleRegistration[] = [];

// ===== 登記 =====

/** 把模組的 navbar 資訊和頁面掛進外殼；網址路徑重複或沒有子頁面時直接丟出錯誤，讓問題在啟動時就出現。 */
export function registerModule(registration: ModuleRegistration): void {
  if (registration.pages.length === 0) {
    throw new Error(`模組 ${registration.module} 沒有任何子頁面`);
  }
  if (registrations.some((existing) => existing.path === registration.path)) {
    throw new Error(`模組的網址路徑重複：${registration.path}`);
  }
  const pagePaths = registration.pages.map((page) => page.path);
  if (new Set(pagePaths).size !== pagePaths.length) {
    throw new Error(`模組 ${registration.module} 的子頁面路徑重複`);
  }
  registrations.push(registration);
}

/** 列出 navbar 某一邊的模組，依登記順序。 */
export function listModulesByPosition(
  position: ModuleRegistration['position'],
): ModuleRegistration[] {
  return registrations.filter((registration) => registration.position === position);
}

// ===== 網址 =====

/** 子頁面的網址路徑，例如 `/settings/basic`。 */
export function buildPagePath(registration: ModuleRegistration, page: PageRegistration): string {
  return `/${registration.path}/${page.path}`;
}

/** 模組第一個子頁面的網址路徑：點 navbar 時進入這裡。 */
export function buildModulePath(registration: ModuleRegistration): string {
  return buildPagePath(registration, registration.pages[0]);
}

/**
 * 首頁：第一個功能模組（左邊）的第一個子頁面；還沒有功能模組時進入「平台設定」。
 * 還沒登記任何模組時回傳 null。
 */
export function getHomePath(): string | null {
  const home = listModulesByPosition('left')[0] ?? registrations[0];
  return home ? buildModulePath(home) : null;
}

/** 找出網址路徑對應的模組和子頁面；不存在時回傳 null。 */
export function resolveRoute(path: string): ResolvedRoute | null {
  const [modulePath, pagePath] = path.split('/').filter(Boolean);
  const registration = registrations.find((candidate) => candidate.path === modulePath);
  const page = registration?.pages.find((candidate) => candidate.path === pagePath);
  if (!registration || !page) return null;
  return { registration, page };
}
