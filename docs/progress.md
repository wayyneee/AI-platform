# 專案進度

## 1. 進度概括
PlatformInfrastructure 的 spec.md 和 page.md 已完成，還沒開始實作。default 主題和「基礎設定」「API 串接」「新增模型視窗」「花費統計」四個 demo 已全部完成並經 PM 確認。下一步：用 project-init 的 B 段設定自動檢查，再開始 implement。B001（頁首白框）等本模組做完再處理。

## 2. 模組
| 模組 | 狀態 |
|---|---|
| **PlatformInfrastructure** | spec 完成 |
| └ SystemLog | spec 完成 |
| └ PlatformBootstrap | spec 完成 |
| └ ThemeAndLanguage | spec 完成 |
| └ ModelService | spec 完成 |
| └ SharedComponents | spec 完成 |
| └ AppShell | spec 完成 |
| └ Page | spec 完成（demo：基礎設定、API 串接、新增模型視窗、花費統計全部完成） |
| **ChatRoom** | |
| **NovelStudio** | |
| **MediaCreation** | |

## 3. 待串接
| 等待的模組 | 需要的介面 | 提供者 | 暫代方式 |
|---|---|---|---|

## 4. Bug 發現列表
### B001：設定頁頁首的看板角色上方有一塊白色方框
- **模組**：PlatformInfrastructure / Page（page.css 的頁首樣式）
- **發現日期**：2026-11-25
- **現象**：頁首右側的看板角色頭部超出頁首上緣的那一截，露出圖片原本的白底，看起來像一塊白色方框。基礎設定、API 串接都有。
- **重現**：開 `page-demo/basic-settings.html` 或 `api-settings.html`，看頁首右上角角色頭部的上方。
- **預期結果**：角色的白底完全融進背景，只看得到角色本身。
- **影響範圍**：所有用同一種頁首的設定子頁面（之後花費統計也會有）；實作時 page.css 搬進 code 也會帶過去。
- **分類**：原因不明（還沒用 analyze-bug 確認）
- **原因**：還沒確認。推測是 `.platform-infrastructure-body` 設了 `position: relative; z-index: 1`，形成獨立的一層，角色圖的 `mix-blend-mode: multiply` 只能和這一層裡的東西混合，碰不到外殼的背景圖，所以超出頁首的部分白底露出來。
- **建議修法**：PM 決定等 PlatformInfrastructure 做完後，再用 analyze-bug 確認原因並修正。

## 5. Bug 解決列表
| 編號 | 模組 | 問題 | 解決方式 | 日期 |
|---|---|---|---|---|

## 6. 想法牆
| 日期 | 想法 | 相關模組 |
|---|---|---|
