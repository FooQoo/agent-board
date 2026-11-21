import type { Preview } from '@storybook/react-vite';
import '../src/shared/styles/tokens.css';
import '../src/shared/styles/app.css';
import '../src/shared/styles/resize.css';
import '../src/shared/styles/ui.css';
import '../src/shared/styles/theme.css';
import { ACCENTS, MODES } from '../src/shared/theme';
import { withStoryEnvironment } from './support/decorators';
import { resetHandlers, startWorker } from './support/msw';

const preview: Preview = {
  // Product requests are answered by MSW handlers a Story adds, and fail otherwise, in the static
  // build and in the browser tests.
  beforeAll: async () => {
    await startWorker();
  },
  beforeEach: () => resetHandlers,
  decorators: [withStoryEnvironment],
  globalTypes: {
    locale: {
      description: 'Language',
      toolbar: {
        title: 'Language',
        icon: 'globe',
        items: [
          { value: 'en', title: 'English' },
          { value: 'ja', title: '日本語' },
        ],
        dynamicTitle: true,
      },
    },
    mode: {
      description: 'Light or dark mode',
      toolbar: {
        title: 'Mode',
        icon: 'contrast',
        items: MODES.map((value) => ({ value, title: value })),
        dynamicTitle: true,
      },
    },
    accent: {
      description: 'Accent color',
      toolbar: {
        title: 'Accent',
        icon: 'paintbrush',
        items: ACCENTS.map((value) => ({ value, title: value })),
        dynamicTitle: true,
      },
    },
    width: {
      description: 'Layout width: desktop board or phone monitor',
      toolbar: {
        title: 'Width',
        icon: 'mobile',
        items: [
          { value: 'desktop', title: 'Desktop (1280px)' },
          { value: 'desktop-900', title: 'Desktop (900px)' },
          { value: 'phone-320', title: 'Phone (320px)' },
          { value: 'phone-375', title: 'Phone (375px)' },
          { value: 'phone-390', title: 'Phone (390px)' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { locale: 'en', mode: 'light', accent: 'blue', width: 'desktop' },
  parameters: {
    layout: 'fullscreen',
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
  tags: ['autodocs'],
};

export default preview;
