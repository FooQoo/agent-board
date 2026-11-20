import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Spinner } from './Spinner';

const meta = {
  title: 'Shared/UI/Spinner',
  component: Spinner,
  args: { label: 'Loading…', size: 'md' },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One spinner: the label is only for screen readers. */
export const Default: Story = {
  render: (args) => (
    <div style={{ padding: 16 }}>
      <Spinner {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
  },
};

/** The three sizes side by side. */
export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16 }}>
      <Spinner size="sm" label="Small" />
      <Spinner size="md" label="Medium" />
      <Spinner size="lg" label="Large" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getAllByRole('status')).toHaveLength(3);
    expect(canvas.getByRole('status', { name: 'Large' })).toBeInTheDocument();
  },
};

/** Centered in a pane, as a loading state fills its place. */
export const InPane: Story = {
  render: (args) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 320,
        height: 160,
        margin: 16,
        border: '1px solid var(--r-border)',
        borderRadius: 8,
        background: 'var(--r-surface)',
      }}
    >
      <Spinner {...args} size="lg" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
  },
};

/** Japanese label in the dark theme. */
export const InPaneJaDark: Story = {
  ...InPane,
  args: { label: '読み込み中…' },
  globals: { locale: 'ja', mode: 'dark' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status', { name: '読み込み中…' })).toBeInTheDocument();
  },
};
