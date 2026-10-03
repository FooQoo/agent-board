import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { mockApi } from './mock-api.ts';

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'mock' ? [mockApi()] : [])],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/app-[name].js',
        assetFileNames: 'assets/app[extname]',
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
}));
