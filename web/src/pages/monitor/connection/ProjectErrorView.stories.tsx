import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { ProjectErrorView } from './ProjectErrorView';

const meta = {
  title: 'Pages/Monitor project error',
  component: ProjectErrorView,
  parameters: { storyFrame: 'monitor', layout: 'fullscreen' },
  globals: { width: 'phone-375' },
  args: { kind: 'missing' },
} satisfies Meta<typeof ProjectErrorView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The address names no project: there is no list to fall back to, and the QR code is the way back. */
export const MissingProject: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'This link has no project' })).toBeVisible();
    await expect(canvas.getByText(/scan the QR code again/)).toBeVisible();
    await expect(canvas.queryByRole('textbox')).toBeNull();
  },
};

/** The address names something that is not a project. */
export const InvalidProject: Story = {
  args: { kind: 'invalid' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'This link is not valid' })).toBeVisible();
    await expect(canvas.getByText(/scan the QR code again/)).toBeVisible();
  },
};

/** The project was deleted or is not there any more. */
export const ProjectNotFound: Story = {
  args: { kind: 'notFound' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('heading', { name: 'This project is no longer available' }),
    ).toBeVisible();
    await expect(canvas.getByText(/scan the QR code again/)).toBeVisible();
  },
};

/** The same screen in Japanese on a narrow phone. */
export const NarrowJapanese: Story = {
  args: { kind: 'notFound' },
  globals: { locale: 'ja', width: 'phone-320' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('heading', { name: 'プロジェクトが見つかりません' }),
    ).toBeVisible();
  },
};
