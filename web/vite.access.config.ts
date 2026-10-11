import { defineConfig } from 'vite';

export default defineConfig({
  base: '/assets/access/',
  build: {
    outDir: 'dist/access',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'access.html',
      output: {
        entryFileNames: 'entry.js',
        chunkFileNames: 'entry-[name]-[hash].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
