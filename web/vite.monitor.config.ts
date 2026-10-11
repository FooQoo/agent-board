import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const dependencyGraph: Plugin = {
  name: 'monitor-dependency-graph',
  generateBundle(_options, bundle) {
    const entry = Object.values(bundle).find(
      (item) => item.type === 'chunk' && item.name === 'monitor',
    );
    if (!entry) throw new Error('Monitor entry chunk is missing.');
    this.emitFile({
      type: 'asset',
      fileName: 'dependency-graph.json',
      source: `${JSON.stringify({ entry: entry.fileName, modules: Object.keys(entry.modules ?? {}).sort() }, null, 2)}\n`,
    });
  },
};

export default defineConfig({
  base: '/assets/monitor/',
  plugins: [react(), tailwindcss(), dependencyGraph],
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
      output: {
        entryFileNames: 'monitor.js',
        chunkFileNames: 'viewer-[name]-[hash].js',
        assetFileNames: 'monitor[extname]',
      },
    },
  },
});
