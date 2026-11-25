// 文字表的集中管理：各模組登記自己的文字表，畫面依目前語言取得文字；找不到文字時顯示文字鍵並寫一筆警告。

import { DEFAULT_LANGUAGE } from '../../../shared/PlatformInfrastructure/types.ts';
import { writeLog } from '../SystemLog/index.ts';
import { platformInfrastructureTexts } from '../texts/zhTW.ts';

const MODULE_NAME = 'PlatformInfrastructure';
// 文字裡的 {名稱} 會換成參數的值
const PARAM_PATTERN = /\{(\w+)\}/g;

export type TextParams = Record<string, string | number>;

const tablesByLanguage = new Map<string, Map<string, string>>();
const reportedMissingKeys = new Set<string>();
let activeLanguage = DEFAULT_LANGUAGE;

// ===== 登記與切換 =====

/** 登記某個語言的文字表；同一個鍵登記第二次時以後登記的為準。 */
export function registerTextTable(language: string, table: Readonly<Record<string, string>>): void {
  const texts = tablesByLanguage.get(language) ?? new Map<string, string>();
  for (const [key, text] of Object.entries(table)) texts.set(key, text);
  tablesByLanguage.set(language, texts);
}

/** 設定畫面使用的語言；由外殼在啟動時依平台設定呼叫，之後要重新整理才會換。 */
export function setActiveLanguage(language: string): void {
  activeLanguage = language;
}

// ===== 取得文字 =====

/** 依目前語言取得文字，並把 {名稱} 換成參數；找不到時回傳文字鍵本身。 */
export function getText(key: string, params?: TextParams): string {
  const text = tablesByLanguage.get(activeLanguage)?.get(key);
  if (text === undefined) {
    reportMissingText(key);
    return key;
  }
  return params ? fillParams(text, params) : text;
}

// ===== 輔助 =====

/** 同一個鍵只寫一筆警告，避免畫面每次重畫都寫一筆（spec 規則）。 */
function reportMissingText(key: string): void {
  if (reportedMissingKeys.has(key)) return;
  reportedMissingKeys.add(key);
  writeLog({
    level: 'warning',
    module: MODULE_NAME,
    action: `找不到文字：${key}（語言 ${activeLanguage}）`,
  });
}

function fillParams(text: string, params: TextParams): string {
  return text.replace(PARAM_PATTERN, (placeholder, name: string) =>
    params[name] === undefined ? placeholder : String(params[name]),
  );
}

// 本模組自己的文字表：其他小模組（外殼、共用元件、設定頁）一載入就要用到
registerTextTable(DEFAULT_LANGUAGE, platformInfrastructureTexts);
