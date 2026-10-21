import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { sharedMermaid } from './chunk-graph.ts';

/**
 * Lists the modules in every chunk this build makes (the entry and the parts it loads later), so a
 * test can check that no board or editor module reaches the monitor. The reused diagram chunks are
 * copied as files and checked by `sharedMermaid`.
 */
const dependencyGraph: Plugin = {
  name: 'monitor-dependency-graph',
  generateBundle(_options, bundle) {
    const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
    const entry = chunks.find((item) => item.name === 'monitor');
    if (!entry) throw new Error('Monitor entry chunk is missing.');
    const modules = [...new Set(chunks.flatMap((chunk) => Object.keys(chunk.modules ?? {})))];
    this.emitFile({
      type: 'asset',
      fileName: 'dependency-graph.json',
      source: `${JSON.stringify({ entry: entry.fileName, modules: modules.sort() }, null, 2)}\n`,
    });
  },
};

export default defineConfig({
  base: '/monitor/assets/monitor/',
  plugins: [
    react(),
    tailwindcss(),
    dependencyGraph,
    sharedMermaid(fileURLToPath(new URL('.', import.meta.url)), '/monitor/assets/monitor/'),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: 'dist/monitor',
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: 0,
    manifest: true,
    rollupOptions: {
      input: 'monitor.html',
      // Named by content like the board build (see vite.config.ts), with the same chunk names.
      output: {
        entryFileNames: 'monitor-[hash].js',
        chunkFileNames: 'chunk-[name]-[hash].js',
        assetFileNames: 'monitor-[hash][extname]',
      },
    },
  },
});
