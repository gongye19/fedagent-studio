import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // 图表库（ECharts）单独成包、按需加载，约 520 kB；首屏包不含它。
    chunkSizeWarningLimit: 600,
  },
})
