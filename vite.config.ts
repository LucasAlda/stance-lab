import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [tanstackStart(), react()],
  server: {
    host: '0.0.0.0', port: 3000,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/stream': { target: 'ws://127.0.0.1:8787', ws: true, changeOrigin: false },
    },
  },
})
