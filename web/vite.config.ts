import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind IPv4 explicitly — matching the API server, and avoiding an IPv6
    // (::1) bind that some environments refuse. Use `vite --host` when you
    // need to reach the dev server from another device (e.g. phone testing).
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      // Server runs separately in dev; the SPA talks to it through this proxy
      // so the frontend never needs to know the API's origin.
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})
