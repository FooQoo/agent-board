import type { StorybookConfig } from '@storybook/react-vite';

// Stories sit beside the product parts they show. The Vite configuration is Storybook's own, so the
// product's mock, live proxy and chunk graph plugins never reach the Storybook build.
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-vitest'],
  framework: {
    name: '@storybook/react-vite',
    options: {
      builder: { viteConfigPath: '.storybook/vite.config.ts' },
    },
  },
  // The product logos in the app's public folder, and the synthetic images for Stories in
  // .storybook/static. Both are served from the root, so one URL works in Storybook and in the tests.
  staticDirs: ['../public', './static'],
  core: { disableTelemetry: true },
};

export default config;
