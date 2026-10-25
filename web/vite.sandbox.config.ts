import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The Docs sandbox page's script (see src/shared/docs-sandbox/main.tsx): a classic script, because the page
// runs in an opaque origin where a module script would need CORS. It is built apart from the
// board so the MDX compiler never reaches the board's first load.
export default defineConfig({
  publicDir: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: 'dist/sandbox',
    emptyOutDir: true,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 2000,
    lib: {
      entry: fileURLToPath(new URL('./src/shared/docs-sandbox/main.tsx', import.meta.url)),
      formats: ['iife'],
      name: 'AgboardDocsSandbox',
    },
    rollupOptions: {
      output: { entryFileNames: 'sandbox-[hash].js' },
      // The MDX compiler's modules end in a bare '' statement, which the bundler reads as a
      // directive it may drop. It is no directive, so that one warning is left out for them.
      onwarn(warning, warn) {
        const where = warning.id ?? warning.loc?.file ?? '';
        if (
          warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
          /node_modules\/(@mdx-js\/mdx|hast-util-to-estree)\//.test(where)
        )
          return;
        warn(warning);
      },
    },
  },
});
