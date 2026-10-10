import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { liveApi, liveProxy } from './live-api.ts';
import { mockApi } from './mock-api.ts';

export default defineConfig(({ mode }) => {
  const backendOrigin = `http://127.0.0.1:${process.env.SKAN_BACKEND_PORT ?? '7421'}`;
  const webOrigin = `http://127.0.0.1:${process.env.SKAN_WEB_PORT ?? '7420'}`;

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(mode === 'mock' ? [mockApi()] : []),
      ...(mode === 'live' ? [liveApi(backendOrigin)] : []),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      host: '127.0.0.1',
      ...(mode === 'live' ? { proxy: { '/api': liveProxy(backendOrigin, webOrigin) } } : {}),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      cssCodeSplit: false,
      modulePreload: false,
      assetsInlineLimit: 0,
      rollupOptions: {
        output: {
          entryFileNames: 'assets/app.js',
          chunkFileNames: 'assets/app-[name]-[hash].js',
          assetFileNames: 'assets/app[extname]',
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
      include: ['test/**/*.test.{ts,tsx}'],
    },
  };
});
