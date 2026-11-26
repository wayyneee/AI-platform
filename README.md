# AI platform

開源、在本機運行的綜合 AI 應用平台，整合角色聊天、小說創作與多媒體生成。使用者用自己的 API key 或本地模型。

## 文件

- 專案做什麼：`docs/design.md`
- 專案規則（資料夾、命名、註解、測試、本專案協定）：`docs/conventions.md`
- 每個模組：`docs/modules/<Module>/spec.md`
- 進度：`docs/progress.md`

## 安裝

需要 [Node.js](https://nodejs.org/) 24 以上（使用內建的 `node:sqlite`）。其他需要的套件，第一次啟動時會自動安裝。

## 啟動

- **Windows**：雙擊根目錄的 `start.bat`。
- **macOS／Linux**：在終端機執行 `./start.sh`。

啟動檔會依序：檢查 Node.js 版本 → 第一次啟動時安裝套件 → 打包畫面 → 啟動平台並自動打開瀏覽器。

- 平台網址：`http://127.0.0.1:4317`（只接受本機連線）。瀏覽器沒有自動打開時，自己輸入這個網址。
- 關掉瀏覽器分頁不會關閉平台，重新輸入網址就能回來。
- 關閉啟動檔的視窗（或按 Ctrl+C），平台就會停止。
- 使用者的資料（API key、設定、log、各模組的資料庫）都存在 `data/`，備份時複製這個資料夾即可。

### 使用本地 Forge 生圖

平台不會自動啟動 Forge。請先自行啟動 Forge，並加上 `--api` 參數，再到「平台設定 → API 串接」新增 Forge 的模型。

## 供應商驗證狀態

六家供應商都依官方文件串接，並用官方文件的請求與回應範例做自動測試。

| 供應商 | 真實 key 驗證 |
|---|---|
| OpenRouter、Grok、本地 Forge | 會用真實 key 手動驗證；聊天、生成畫面完成後一起驗證 |
| OpenAI、Gemini、Claude | **尚未用真實 key 驗證**，目前只有自動測試 |

## 開發

開發時前端和後端分開跑，改了 code 畫面會自動更新：

```
npm install
npm run dev:server   # 後端：http://127.0.0.1:4317，改了 code 自動重啟
npm run dev:client   # 前端：http://127.0.0.1:5173，/api 轉給後端
```

開發時打開 `http://127.0.0.1:5173`。`npm start` 是啟動檔用的指令：先打包畫面到 `dist/`，再由後端一起提供畫面和 `/api`。

## 測試與檢查

```
npm run check   # 總檢查：型別、lint、格式、模組邊界
npm test        # 測試
npm run format  # 自動整理格式
```

各指令分別檢查什麼，見 `docs/conventions.md` 第 9 段「自動檢查指令」。自動測試的資料放在暫存資料夾，不會碰到 `data/`。
