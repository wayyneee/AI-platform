# 專案資料夾架構

> 由 update-structure skill 依 docs 產生，不手動編輯。內容為 docs 規劃的架構，不代表已實作。

```
/
├── CLAUDE.md                          協作規則
├── .gitattributes                     換行符號設定
├── .gitignore                         不進 git 的檔案
├── docs/
│   ├── structure.md                   資料夾架構圖
│   └── modules/                       核心模組文件
├── src/
│   ├── shared/                        共用介面與型別
│   ├── server/                        後端邏輯
│   └── client/                        前端畫面
├── public/theme/                      主題與素材
└── data/                              執行期資料（不進 git）
```
