# AI platform

開源、在本機運行的綜合 AI 應用平台，整合角色聊天、小說創作與多媒體生成。使用者用自己的 API key 或本地模型。

## 文件

- 專案做什麼：`docs/design.md`
- 專案規則（資料夾、命名、註解、測試、本專案協定）：`docs/conventions.md`
- 每個模組：`docs/modules/<Module>/spec.md`
- 進度：`docs/progress.md`

## 安裝

需要 Node.js 24 以上（使用內建的 `node:sqlite`）。

```
npm install
```

（其餘步驟在第一個可以執行的版本完成後填寫）

## 啟動

（第一個可以執行的版本完成後填寫）

## 測試與檢查

```
npm run check   # 總檢查：型別、lint、格式、模組邊界
npm test        # 測試
npm run format  # 自動整理格式
```

各指令分別檢查什麼，見 `docs/conventions.md` 第 9 段「自動檢查指令」。
