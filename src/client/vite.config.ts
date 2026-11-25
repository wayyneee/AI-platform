// 前端（Vite）的設定：前端的根目錄是 src/client/，畫面素材與主題從 public/ 提供，/api 轉給本機的後端。

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 和後端進入點（src/server/main.ts）的位址相同
const BACKEND_URL = 'http://127.0.0.1:4317';
const CLIENT_PORT = 5173;

export default defineConfig({
  // 指令從專案根目錄執行，路徑都相對於根目錄
  root: 'src/client',
  publicDir: '../../public',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: CLIENT_PORT,
    strictPort: true,
    proxy: { '/api': BACKEND_URL },
  },
  build: { outDir: '../../dist', emptyOutDir: true },
});
