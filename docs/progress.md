# 專案進度

## 1. 進度概括
PlatformInfrastructure 實作完成，標為「待串接」：雙擊根目錄的 `start.bat`（macOS／Linux 用 `start.sh`）即可開啟平台；平台設定（基礎設定、API 串接、花費統計）可用；invokeModel、streamModel、submitTask、getTask 可供其他模組後端使用。所有驗收條件都有自動測試；PM 決定不逐條手動驗收，改為 ChatRoom 等功能做好後，實際使用時回饋問題（2026-11-27）。真實 key 的驗證見待串接。page-demo 已刪除，畫面以實際 app 為準。下一步：ChatRoom 的 spec。

## 2. 模組
| 模組 | 狀態 |
|---|---|
| **PlatformInfrastructure** | 待串接 |
| └ SystemLog | 完成 |
| └ PlatformBootstrap | 完成 |
| └ ThemeAndLanguage | 完成 |
| └ ProviderConnectors | 完成（真實 key 驗證見待串接） |
| └ ModelRegistry | 完成（真實 key 驗證見待串接） |
| └ UsageAndCost | 完成 |
| └ ModelInvocation | 完成（真實 key 驗證見待串接） |
| └ SharedComponents | 完成（任務進度元件見待串接） |
| └ AppShell | 完成 |
| └ Page | 完成（基礎設定、API 串接、花費統計） |
| **ChatRoom** | |
| **NovelStudio** | |
| **MediaCreation** | |

## 3. 實作分段
（只放正在實作的模組，完成時清空）

（目前無）

## 4. 待串接
| 等待的模組 | 需要的介面 | 提供者 | 暫代方式 |
|---|---|---|---|
| PlatformInfrastructure | 對話畫面（真實 key 驗證：OpenRouter、Grok 的新增模型、圖片、PDF、工具、搜尋、思考；Gemini 兩輪對話） | ChatRoom | 先以自動測試驗證，ChatRoom 做好後實際使用時回饋 |
| PlatformInfrastructure | 生成畫面（真實 key 驗證：圖片、影片、語音、Forge；任務進度顯示） | MediaCreation | 先以自動測試驗證，MediaCreation 做好後實際使用時回饋 |

## 5. Bug 發現列表
（目前無）

## 6. Bug 解決列表
| 編號 | 模組 | 問題 | 解決方式 | 日期 |
|---|---|---|---|---|
| B001 | PlatformInfrastructure / Page | 設定頁頁首的看板角色上方有一塊白色方框：`.platform-infrastructure-body` 的 `z-index: 1` 形成獨立圖層，角色的 multiply 碰不到外殼背景圖 | 拿掉 body 的 z-index；demo 切換列的背景佔位文字改插在外殼最前面（skill 副本同步）；log 列 z-index 提高到 20，page.css 註明頁面內元件 z-index 不超過 10 | 2026-11-25 |

## 7. 想法牆
| 日期 | 想法 | 相關模組 |
|---|---|---|
| 2026-11-26 | 發言後切到別的頁面，回覆不可以中斷：由 ChatRoom 後端呼叫 streamModel 並存下回覆，只有按停止才中止；切回聊天室時接著顯示（寫 ChatRoom spec 時納入） | ChatRoom |
