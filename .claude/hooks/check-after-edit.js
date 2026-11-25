// 改完檔案後的自動檢查（Claude Code 的 PostToolUse hook）。
// 改到 code 或設定檔時：先用 Prettier 整理那個檔案，再跑總檢查 npm run check；失敗時把錯誤回報給 Claude。

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// 只有改到這些位置才檢查：改 docs 時不用等檢查
const CHECKED_FOLDERS = ['src', 'tests'];
const ROOT_CONFIG_FILES = /^(package\.json|eslint\.config\.js|\.dependency-cruiser\.cjs)$/;
// exit code 2 代表檢查失敗：Claude Code 會把 stderr 的內容顯示給 Claude
const EXIT_CHECK_FAILED = 2;

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

// ===== 主流程 =====

const editedFile = readEditedFile();
if (editedFile && isCheckedFile(editedFile)) {
  formatFile(editedFile);
  runCheck();
}

// ===== 步驟 =====

/** 從 hook 的輸入讀出剛改的檔案路徑；讀不到時回傳 null。 */
function readEditedFile() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  return input.tool_input?.file_path ?? null;
}

/** 判斷這個檔案改完後要不要檢查。 */
function isCheckedFile(file) {
  const relativePath = path.relative(projectDir, file).split(path.sep).join('/');
  if (relativePath.startsWith('..')) return false;
  const topFolder = relativePath.split('/')[0];
  return CHECKED_FOLDERS.includes(topFolder) || ROOT_CONFIG_FILES.test(relativePath);
}

/** 用 Prettier 整理剛改的檔案；.prettierignore 列出的檔案 Prettier 會自動略過。 */
function formatFile(file) {
  const prettierPath = path.join(projectDir, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
  spawnSync(process.execPath, [prettierPath, '--write', '--ignore-unknown', file], {
    cwd: projectDir,
  });
}

/** 跑總檢查；失敗時把錯誤交給 Claude。 */
function runCheck() {
  // Windows 的 npm 是 .cmd 檔，要透過 shell 執行
  const result = spawnSync('npm run check --silent', {
    cwd: projectDir,
    shell: true,
    encoding: 'utf8',
  });
  if (result.status === 0) return;
  process.stderr.write(`總檢查 npm run check 沒有通過：\n${result.stdout}${result.stderr}`);
  process.exit(EXIT_CHECK_FAILED);
}
