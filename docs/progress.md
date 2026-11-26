# 專案進度

## 1. 進度概括
PlatformInfrastructure 實作中，分成 10 段（第 4 段拆成 4a、4b，見第 3 段）。spec、page.md、default 主題、四個 demo、自動檢查都已完成；真實 key 的手動驗收只做 OpenRouter、Grok 和本地 Forge。第 1 段後端地基、第 2 段第一個能操作的畫面、第 3 段共用元件補齊＋未儲存離開確認已完成（`npm run dev:server`＋`npm run dev:client` 可開啟平台設定）；第 4a 段五家 LLM 串接、第 4b 段圖片、影片、語音與 Forge 串接完成（自動測試通過，真實 key 驗收等 ChatRoom、MediaCreation 串接後）；第 5 段 API key、第 6 段模型完成（API 串接頁的 API key、模型分頁與新增模型視窗可用；OpenRouter、Grok 用真實 key 新增模型的手動驗收待 PM）；第 7 段用量與花費完成（花費統計頁可用，真的用量紀錄要等第 8 段呼叫模型時才會產生）。下一步：第 8 段模型呼叫（ModelInvocation：呼叫、串流與中止、工具、搜尋、長時間任務，呼叫完記錄用量）。

## 2. 模組
| 模組 | 狀態 |
|---|---|
| **PlatformInfrastructure** | 實作中 |
| └ SystemLog | 完成 |
| └ PlatformBootstrap | 完成 |
| └ ThemeAndLanguage | 完成 |
| └ ProviderConnectors | 完成（真實 key 驗收見待串接） |
| └ ModelRegistry | 完成（OpenRouter、Grok 真實 key 的手動驗收待 PM） |
| └ UsageAndCost | 完成 |
| └ ModelInvocation | spec 完成 |
| └ SharedComponents | 完成（任務進度元件等 MediaCreation 串接後手動驗收） |
| └ AppShell | 完成 |
| └ Page | 完成（基礎設定、API 串接、花費統計） |
| **ChatRoom** | |
| **NovelStudio** | |
| **MediaCreation** | |

## 3. 實作分段
（只放正在實作的模組，完成時清空）

**PlatformInfrastructure**
| 段 | 做什麼 | 狀態 |
|---|---|---|
| 1 | 後端地基：SystemLog 後端（錯誤物件、寫 log、換檔、即時推送、錯誤攔截）、PlatformBootstrap（建立 data/、資料庫工具與升級） | 完成 |
| 2 | 第一個能操作的畫面：ThemeAndLanguage、AppShell（navbar、側邊欄、log 列、路由、錯誤畫面）、BasicSettings 和它用到的共用元件 | 完成 |
| 3 | 共用元件補齊（視窗、確認、可搜尋選單、提示、錯誤訊息、任務進度）＋未儲存離開確認 | 完成 |
| 4a | ProviderConnectors 的 LLM：OpenAI、Gemini、Claude、Grok、OpenRouter 的格式轉換、回應解析、串流、錯誤代碼、模型偵測（能力、價格、可調參數） | 完成 |
| 4b | ProviderConnectors 的圖片、影片、語音：Grok、OpenRouter、Forge 的送出、查進度、取結果、可選項目即時查詢；改圖、讓圖動、多個 LoRA | 完成 |
| 5 | API key：ModelRegistry 的 key 部分、API key 分頁 | 完成 |
| 6 | 模型：ModelRegistry 的模型部分（偵測、測試、能力、參數、價格）、模型分頁、新增模型視窗 | 完成 |
| 7 | 用量與花費：UsageAndCost、花費統計頁 | 完成 |
| 8 | 模型呼叫：ModelInvocation（呼叫、串流與中止、工具、搜尋、長時間任務） | 未開始 |
| 9 | 收尾：啟動檔、README（含 OpenAI、Gemini、Claude 尚未用真實 key 驗證）、手動驗收、刪除 page-demo | 未開始 |

## 4. 待串接
| 等待的模組 | 需要的介面 | 提供者 | 暫代方式 |
|---|---|---|---|
| PlatformInfrastructure | 對話畫面（真實 key 驗收：OpenRouter、Grok 的圖片、PDF、工具、搜尋、思考；Gemini 兩輪對話） | ChatRoom | 先以自動測試驗證，ChatRoom 串接後手動驗收 |
| PlatformInfrastructure | 生成畫面（真實 key 驗收：圖片、影片、語音、Forge；任務進度顯示） | MediaCreation | 先以自動測試驗證，MediaCreation 串接後手動驗收 |

## 5. Bug 發現列表
（目前無）

## 6. Bug 解決列表
| 編號 | 模組 | 問題 | 解決方式 | 日期 |
|---|---|---|---|---|
| B001 | PlatformInfrastructure / Page | 設定頁頁首的看板角色上方有一塊白色方框：`.platform-infrastructure-body` 的 `z-index: 1` 形成獨立圖層，角色的 multiply 碰不到外殼背景圖 | 拿掉 body 的 z-index；demo 切換列的背景佔位文字改插在外殼最前面（skill 副本同步）；log 列 z-index 提高到 20，page.css 註明頁面內元件 z-index 不超過 10 | 2026-11-25 |

## 7. 想法牆
| 日期 | 想法 | 相關模組 |
|---|---|---|
