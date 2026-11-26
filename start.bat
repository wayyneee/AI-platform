@echo off
chcp 65001 >nul
rem 一鍵啟動平台（Windows）：檢查 Node.js、第一次安裝套件、打包畫面、啟動後端並打開瀏覽器。
rem 第二行先切成 UTF-8，下面的中文才不會變亂碼。
title AI platform
cd /d "%~dp0"

rem ===== 檢查 Node.js 24 以上（內建 node:sqlite）=====
where node >nul 2>nul
if errorlevel 1 goto :node_missing
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 goto :node_missing

rem ===== 第一次啟動：安裝套件 =====
if not exist "node_modules\" (
  echo 第一次啟動，正在安裝需要的套件，約需幾分鐘...
  call npm install
  if errorlevel 1 goto :failed
)

rem ===== 打包畫面並啟動平台（關閉這個視窗就會關閉平台）=====
echo 正在準備畫面...
call npm start --silent
goto :failed

:node_missing
echo 需要 Node.js 24 以上才能執行平台，請到 https://nodejs.org/ 下載安裝後再開一次。
pause
exit /b 1

:failed
echo.
echo 平台已停止。如果上面有錯誤訊息，請截圖回報。
pause
exit /b 1
