import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    // El frontend solo habla con el backend por HTTP: en desarrollo Vite reenvía /api al servidor.
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:3000' } },
  },
  build: { sourcemap: false },
})
