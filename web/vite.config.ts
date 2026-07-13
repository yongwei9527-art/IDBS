import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// IDBS 5.0 canonical web build and deployment base.
const V5_BASE = '/v5/';
const API_PROXY_TARGET = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [
    react()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  base: V5_BASE,
  build: {
    outDir: path.resolve(__dirname, '../public/v5'),
    emptyOutDir: true,
    sourcemap: process.env.VITE_SOURCE_MAP === 'true' ? 'hidden' : false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
          return 'vendor';
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        ws: true,
        configure(proxy) {
          // Keep browser authentication tokens off the URL. The backend only
          // accepts configured origins, so normalize proxied WS origin to the
          // API target while the browser remains on the Vite origin.
          proxy.on('proxyReqWs', (proxyReq) => {
            proxyReq.setHeader('origin', API_PROXY_TARGET);
          });
        }
      },
      '/wechat': {
        target: API_PROXY_TARGET,
        changeOrigin: true
      },
      '/uploads': {
        target: API_PROXY_TARGET,
        changeOrigin: true
      }
    }
  }
});
