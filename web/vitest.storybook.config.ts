import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Browser tests of the Stories and of the Storybook support. The product's jsdom configuration in
// vite.config.ts is separate: it keeps its own setup and includes.
const root = fileURLToPath(new URL('.', import.meta.url));
// The synthetic images for Stories, served from the root as Storybook serves them.
const storyStatic = `${root}.storybook/static`;

const browser = (name: string) => ({
  enabled: true,
  headless: true,
  provider: playwright(),
  instances: [{ browser: 'chromium' as const, name }],
});

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: { '@': `${root}src` },
        },
        publicDir: storyStatic,
        plugins: [
          tailwindcss(),
          // Runs every Story as a test. The addon takes the Stories from .storybook/main.ts.
          storybookTest({
            configDir: `${root}.storybook`,
            storybookScript: 'storybook dev -p 8611 -h 127.0.0.1 --no-open --ci',
          }),
        ],
        test: {
          name: 'storybook',
          api: { host: '127.0.0.1', port: 8612, strictPort: true },
          setupFiles: ['.storybook/vitest.setup.ts'],
          browser: browser('stories'),
        },
      },
      {
        resolve: {
          alias: { '@': `${root}src` },
        },
        publicDir: storyStatic,
        test: {
          name: 'storybook-support',
          api: { host: '127.0.0.1', port: 8613, strictPort: true },
          include: ['.storybook/**/*.browser.test.{ts,tsx}'],
          setupFiles: ['.storybook/vitest.setup.ts'],
          browser: browser('support'),
        },
      },
    ],
  },
});
