import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/admin-panel/',
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/admin-app.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name ?? ''
          if (name.endsWith('.css')) {
            return 'assets/admin-app.css'
          }
          return 'assets/[name]-[hash][extname]'
        },
      },
    },
  },
})
