// 用啟動檔執行時提供畫面：後端同時提供打包後的前端（dist/）和 /api，平台開好後打開瀏覽器。
// 開發時不經過這裡，畫面由 Vite 開發伺服器提供並把 /api 轉給後端（design.md 部署）。

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

import { createError, defineErrorCodes, writeLog } from '../SystemLog/index.ts';
import { PROJECT_ROOT } from './dataDirectory.ts';

const MODULE_NAME = 'PlatformInfrastructure';
// vite.config.ts 的 build.outDir
const CLIENT_DIRECTORY = path.join(PROJECT_ROOT, 'dist');
const CLIENT_ENTRY_FILE = 'index.html';

export const ClientAppErrorCodes = defineErrorCodes({
  PLATFORM_CLIENT_NOT_BUILT: 'error',
  PLATFORM_BROWSER_OPEN_FAILED: 'error',
});

// ===== 主要流程 =====

/** 由後端提供打包後的畫面，平台開始接受連線後印出網址並打開瀏覽器；畫面還沒打包時丟出錯誤。 */
export async function serveClientApp(server: FastifyInstance): Promise<void> {
  await registerClientFiles(server, CLIENT_DIRECTORY);
  server.addHook('onListen', async () => {
    const platformUrl = readPlatformUrl(server);
    announcePlatformUrl(platformUrl);
    openBrowser(platformUrl);
  });
}

/** 把某個資料夾裡打包好的畫面掛到網站根目錄；/api 的路由和找不到時的錯誤格式不受影響。 */
export async function registerClientFiles(
  server: FastifyInstance,
  clientDirectory: string,
): Promise<void> {
  ensureClientBuilt(clientDirectory);
  // @fastify/static 會擋掉讀取資料夾以外檔案的路徑；找不到檔案時交給平台的「找不到」處理
  await server.register(fastifyStatic, { root: clientDirectory });
}

// ===== 檢查 =====

function ensureClientBuilt(clientDirectory: string): void {
  if (existsSync(path.join(clientDirectory, CLIENT_ENTRY_FILE))) return;
  throw createError(
    MODULE_NAME,
    'serveClientApp',
    ClientAppErrorCodes.PLATFORM_CLIENT_NOT_BUILT,
    `找不到打包後的畫面（${clientDirectory}${path.sep}${CLIENT_ENTRY_FILE}），請先執行 npm run build`,
  );
}

// ===== 開瀏覽器 =====

function readPlatformUrl(server: FastifyInstance): string {
  const listening = server.addresses()[0];
  // 字串代表聽的是本機 socket 檔而不是網路位址，平台不會這樣啟動，直接用原值
  if (typeof listening === 'string') return listening;
  return `http://${listening.address}:${listening.port}`;
}

/** 在啟動檔的視窗印出網址：瀏覽器沒有自動打開時，使用者可以自己輸入。 */
function announcePlatformUrl(platformUrl: string): void {
  process.stdout.write(`\n平台已啟動：${platformUrl}\n關閉這個視窗就會關閉平台。\n\n`);
}

/** 用系統預設的瀏覽器打開平台；失敗時只寫 log，平台照常執行。 */
function openBrowser(platformUrl: string): void {
  const command = buildOpenCommand(platformUrl);
  const child = spawn(command.file, command.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', (reason) => {
    const error = createError(
      MODULE_NAME,
      'serveClientApp',
      ClientAppErrorCodes.PLATFORM_BROWSER_OPEN_FAILED,
      `無法自動打開瀏覽器：${reason.message}`,
      { command: command.file },
    );
    writeLog({ level: 'error', module: MODULE_NAME, action: '打開瀏覽器', error });
  });
  child.unref();
}

/** 各作業系統打開網址的指令。 */
function buildOpenCommand(platformUrl: string): { file: string; args: string[] } {
  // Windows 的 start 第一個引號參數是視窗標題，所以先放一個空字串
  if (process.platform === 'win32') return { file: 'cmd', args: ['/c', 'start', '', platformUrl] };
  if (process.platform === 'darwin') return { file: 'open', args: [platformUrl] };
  return { file: 'xdg-open', args: [platformUrl] };
}
