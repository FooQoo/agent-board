import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { chunkGraph } from './chunk-graph.ts';
import { liveApi, liveProxy } from './live-api.ts';
import { mockApi } from './mock-api.ts';

export default defineConfig(({ mode }) => {
  const backendOrigin = `http://127.0.0.1:${process.env.AGBOARD_BACKEND_PORT ?? '7421'}`;
  const webOrigin = `http://127.0.0.1:${process.env.AGBOARD_WEB_PORT ?? '7420'}`;

  return {
    plugins: [
      react(),
      tailwindcss(),
      chunkGraph(),
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
      // Vite's single limit cannot tell the first load from code loaded on use. The first load has
      // its own budget in test/monitor/build-contract.test.ts, which also requires every chunk over
      // 500 kB to load on use only: Mermaid's ELK layout (about 1.5 MB), its grammar parser and the
      // rich editor. The limit sits just above the largest of those.
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        // Every file is named by its content, so the server can let browsers keep it for a
        // year. Chunks share their naming with the monitor build: a chunk both builds produce
        // from the same modules (the diagram renderer) has the same bytes and is embedded once.
        output: {
          entryFileNames: 'assets/app-[hash].js',
          chunkFileNames: 'assets/chunk-[name]-[hash].js',
          assetFileNames: 'assets/app-[hash][extname]',
          // The diagram renderer's on-demand imports go through Vite's preload helper. In a
          // chunk of its own it keeps the renderer free of the entry, so the monitor can reuse it.
          codeSplitting: {
            groups: [{ name: 'preload-helper', test: /vite\/preload-helper/ }],
          },
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
