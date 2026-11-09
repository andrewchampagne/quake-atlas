/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin in dev: /api is proxied to FastAPI (CORS is also enabled server-side).
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
  // MapLibre's worker is an ES module (see src/lib/maplibre.ts).
  worker: { format: 'es' },
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('maplibre-gl')) return 'maplibre';
          if (id.includes('@deck.gl') || id.includes('@luma.gl') || id.includes('@math.gl')) return 'deckgl';
          if (id.includes('recharts') || id.includes('d3-')) return 'charts';
          if (id.includes('apache-arrow')) return 'arrow';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
