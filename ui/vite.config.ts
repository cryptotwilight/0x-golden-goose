import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // If you tunnel the dev server through ngrok, Vite may reject the Host header
  // (e.g. `xxxxx.ngrok-free.dev`) unless it’s allowed here.
  server: {
    host: true,
    allowedHosts: 'all',
  },
  preview: {
    host: true,
    allowedHosts: 'all',
  },
  build: {
    outDir: 'dist',
  },
})
