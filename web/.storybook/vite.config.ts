import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Storybook's own Vite configuration. It keeps the product's aliases and Tailwind, and none of the
// product's mock API, live proxy, chunk graph or build output settings. The React plugin comes from
// the Storybook framework.
export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  },
});
