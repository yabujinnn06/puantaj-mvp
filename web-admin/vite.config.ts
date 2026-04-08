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
        manualChunks: (id) => {
          if (!id.includes('node_modules')) {
            return undefined
          }
          if (id.includes('leaflet') || id.includes('maplibre-gl')) {
            return 'maps-vendor'
          }
          if (id.includes('@tanstack/react-query') || id.includes('axios') || id.includes('zod')) {
            return 'data-vendor'
          }
          if (id.includes('qrcode')) {
            return 'qr-vendor'
          }
          return 'vendor'
        },
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
