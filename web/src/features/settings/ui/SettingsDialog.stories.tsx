import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import type { LocaleStorageProvider } from '../../../shared/i18n';
import type { ThemeStorageProvider } from '../../../shared/theme';
import { SettingsDialog } from './SettingsDialog';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}
const localeStorageProvider: LocaleStorageProvider = memoryStorage;
const themeStorageProvider: ThemeStorageProvider = memoryStorage;
const meta: Meta<typeof SettingsDialog> = {
  title: 'Settings/SettingsDialog',
  component: SettingsDialog,
  parameters: { layout: 'fullscreen' },
  args: { open: true, onOpenChange: () => {}, localeStorageProvider, themeStorageProvider },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const LanguageAndThemes: Story = {
  play: async () => {
    const view = within(document.body);
    await expect(view.getByRole('dialog')).toBeInTheDocument();
    await expect(view.getAllByRole('radio')).toHaveLength(26);
    await userEvent.click(view.getByRole('radio', { name: '日本語' }));
    await userEvent.click(view.getByRole('radio', { name: /dark.*purple/i }));
  },
};
const failingStorage = (): Storage => ({
  ...memoryStorage(),
  setItem: () => {
    throw new Error('storage unavailable');
  },
});
export const StorageFailure: Story = {
  args: { localeStorageProvider: failingStorage, themeStorageProvider: failingStorage },
  play: async () => {
    const view = within(document.body);
    await userEvent.click(view.getByRole('radio', { name: /dark.*purple/i }));
    await expect(view.getByRole('alert')).toBeInTheDocument();
  },
};
