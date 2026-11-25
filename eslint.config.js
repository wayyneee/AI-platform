// ESLint 設定：抓常見錯誤，並把 conventions.md 裡機器能檢查的規則交給機器（巢狀層數、log、檔案與函式長度）。
// 格式（縮排、空白、換行）交給 Prettier，這裡關掉會和 Prettier 衝突的規則。

import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// conventions.md 第 6 段的長度建議：超過只提醒，不算檢查失敗
const MAX_FILE_LINES = 400;
const MAX_FUNCTION_LINES = 50;
// conventions.md 第 6 段：巢狀不超過三層
const MAX_NESTING_DEPTH = 3;

const lengthOptions = { skipBlankLines: true, skipComments: true };

export default defineConfig([
  // ===== 不檢查的位置 =====
  // docs/ 是文件和 demo 草稿，public/ 是素材，都不是正式的 code
  globalIgnores(['docs/', 'public/', 'data/', 'dist/']),

  // ===== 共通規則 =====
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      'max-depth': ['error', MAX_NESTING_DEPTH],
      // 所有 log 都透過 PlatformInfrastructure 的 writeLog（conventions.md 第 9 段）
      'no-console': 'error',
      eqeqeq: 'error',
      'max-lines': ['warn', { max: MAX_FILE_LINES, ...lengthOptions }],
      'max-lines-per-function': ['warn', { max: MAX_FUNCTION_LINES, ...lengthOptions }],
    },
  },

  // ===== 執行環境 =====
  {
    files: ['src/server/**', 'tests/**', '*.{js,ts}', '.claude/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/client/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },

  // ===== 測試檔 =====
  // 測試用 describe 把多條驗收條件包在一起，函式本來就長
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: { 'max-lines-per-function': 'off' },
  },

  prettierConfig,
]);
