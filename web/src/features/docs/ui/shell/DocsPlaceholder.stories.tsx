import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { docsRootPath } from '../../../../../.storybook/support/docs-fixtures';
import { DocsPlaceholder } from './DocsPlaceholder';

const meta = {
  title: 'Docs/Shell/DocsPlaceholder',
  component: DocsPlaceholder,
  args: { kind: 'noFile' },
  decorators: [
    (Story) => (
      <div style={{ width: 900, height: 480, display: 'flex' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DocsPlaceholder>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No file chosen: the guidance fills the center. */
export const NoFileSelected: Story = {
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByRole('heading', { name: 'Select a file' })).toBeVisible();
    await expect(view.queryByRole('button')).toBeNull();
  },
};

/** Japanese wording of the guidance. */
export const NoFileSelectedJapanese: Story = {
  globals: { locale: 'ja' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('heading', { name: 'ファイルを選択してください' }),
    ).toBeVisible();
  },
};

/** No docs yet: the guidance names the folder and offers to copy its path. */
export const NoDocs: Story = {
  args: { kind: 'noDocs', rootPath: docsRootPath },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByRole('heading', { name: 'This project has no docs' })).toBeVisible();
    await expect(view.getByText(docsRootPath)).toBeVisible();
    await userEvent.click(view.getByRole('button', { name: 'Copy the folder path' }));
  },
};

/** The phone wording drops the reference to the list "on the left". */
export const NoFileSelectedCompact: Story = {
  args: { compact: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Choose a Markdown file to show it.'),
    ).toBeVisible();
  },
};
