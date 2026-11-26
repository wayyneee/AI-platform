#!/usr/bin/env sh
# 一鍵啟動平台（macOS／Linux）：檢查 Node.js、第一次安裝套件、打包畫面、啟動後端並打開瀏覽器。

cd "$(dirname "$0")" || exit 1

# ===== 檢查 Node.js 24 以上（內建 node:sqlite）=====
if ! command -v node >/dev/null 2>&1 ||
  ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"; then
  echo "需要 Node.js 24 以上才能執行平台，請到 https://nodejs.org/ 下載安裝後再執行一次。"
  exit 1
fi

# ===== 第一次啟動：安裝套件 =====
if [ ! -d node_modules ]; then
  echo "第一次啟動，正在安裝需要的套件，約需幾分鐘..."
  npm install || exit 1
fi

# ===== 打包畫面並啟動平台（按 Ctrl+C 或關閉視窗就會關閉平台）=====
echo "正在準備畫面..."
exec npm start --silent
