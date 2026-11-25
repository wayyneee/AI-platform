// 模組邊界檢查（dependency-cruiser）：把 conventions.md 第 4 段的規則交給機器檢查。
// 路徑形狀：src/<server|client>/<Module>/<SubModule>/<檔案>；「index」指 index.ts 或 index.tsx。
// 規則裡的 $1、$2、$3 指 from.path 括號抓到的層、模組、小模組名稱。

const INDEX_FILE = 'index\\.tsx?$';
// 前端模組的 page/、texts/ 是模組本身的內部資料夾，不是小模組（conventions.md 第 2 段）
const CLIENT_MODULE_FOLDERS = '^src/$1/$2/(page|texts)/';

module.exports = {
  forbidden: [
    // ===== 前後端分開 =====
    {
      name: 'client-not-import-server',
      comment: '前端不引用後端的檔案，兩邊都要用的放 src/shared/',
      severity: 'error',
      from: { path: '^src/client/' },
      to: { path: '^src/server/' },
    },
    {
      name: 'server-not-import-client',
      comment: '後端不引用前端的檔案，兩邊都要用的放 src/shared/',
      severity: 'error',
      from: { path: '^src/server/' },
      to: { path: '^src/client/' },
    },
    {
      name: 'shared-not-import-server-or-client',
      comment: 'src/shared/ 前後端都要能用，不引用任何一邊',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/(server|client)/' },
    },

    // ===== 核心模組只透過 index 對外 =====
    {
      name: 'other-module-only-through-index',
      comment: '跨核心模組時，只能引用對方核心模組的 index',
      severity: 'error',
      from: { path: '^src/(server|client)/([^/]+)/' },
      to: {
        path: '^src/$1/[^/]+/',
        pathNot: ['^src/$1/$2/', `^src/$1/[^/]+/${INDEX_FILE}`],
      },
    },
    {
      name: 'entry-only-through-index',
      comment: '進入點 main 只登記各模組，只能引用模組的 index',
      severity: 'error',
      from: { path: '^src/(server|client)/[^/]+$' },
      to: {
        path: '^src/$1/[^/]+/',
        pathNot: `^src/$1/[^/]+/${INDEX_FILE}`,
      },
    },
    {
      name: 'e2e-only-through-index',
      comment: '端對端測試只透過模組的 index 使用，不碰模組內部',
      severity: 'error',
      from: { path: '^tests/' },
      to: {
        path: '^src/(server|client)/[^/]+/',
        pathNot: `^src/(server|client)/[^/]+/${INDEX_FILE}`,
      },
    },

    // ===== 小模組只透過 index 對外 =====
    {
      name: 'other-submodule-only-through-index',
      comment: '小模組之間只能引用對方小模組的 index',
      severity: 'error',
      from: { path: '^src/(server|client)/([^/]+)/([^/]+)/' },
      to: {
        path: '^src/$1/$2/[^/]+/',
        pathNot: ['^src/$1/$2/$3/', `^src/$1/$2/[^/]+/${INDEX_FILE}`, CLIENT_MODULE_FOLDERS],
      },
    },
    {
      name: 'module-root-to-submodule-only-through-index',
      comment: '模組的 index 只能引用小模組的 index',
      severity: 'error',
      from: { path: '^src/(server|client)/([^/]+)/[^/]+$' },
      to: {
        path: '^src/$1/$2/[^/]+/',
        pathNot: [`^src/$1/$2/[^/]+/${INDEX_FILE}`, CLIENT_MODULE_FOLDERS],
      },
    },

    // ===== 不可以互相依賴 =====
    {
      name: 'no-circular',
      comment: 'A 用 B、B 又用 A 代表切法有問題，要和 PM 討論（conventions.md 第 4 段）',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    includeOnly: '^(src|tests)/',
    // 只引用型別的 import 也要檢查：跨模組引用型別同樣要透過 index
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.tsx', '.js'] },
  },
};
