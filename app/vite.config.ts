import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 开发时前端在 8880，后端（fedagent dev）在 8000：/v1 和 /healthz 转给后端，和生产环境同一个地址下访问一样。
const backend = process.env.FEDAGENT_API ?? 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/v1': backend,
      '/healthz': backend,
    },
  },
  build: { chunkSizeWarningLimit: 600 },
})
