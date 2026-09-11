import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // في التطوير نمرّر نداءات الـ API إلى مشروع الباك اند (api/) فلا نحتاج CORS
    proxy: {
      '/api': {
        target: 'http://localhost:5279',
        changeOrigin: true,
      },
    },
  },
})
