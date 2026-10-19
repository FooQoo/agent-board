import type { Meta, StoryObj } from '@storybook/react-vite';
import { MarkdownSections } from './MarkdownSections';
import { LazyMarkdownSections } from './LazyMarkdownSections';

const source = `Intro paragraph.\n\n## First chapter\n\nChapter body.\n\n## Second chapter\n\nAnother paragraph.`;

const meta = {
  title: 'Shared/Markdown/MarkdownSections',
  component: MarkdownSections,
  args: { source },
} satisfies Meta<typeof MarkdownSections>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Chapters: Story = {
  render: (args) => (
    <>
      <MarkdownSections {...args} />
      <LazyMarkdownSections {...args} />
    </>
  ),
};
