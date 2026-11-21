import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { TaskAttachScreen } from './TaskAttachScreen';

// The Ask AI composer with an "Attach task" button right of "Image", and three ways to pick tasks. Static data.
const meta = {
  title: 'Mocks/TaskAttachPicker/Phone',
  component: TaskAttachScreen,
  args: { variant: 'phone', option: 'sheet', stage: 'composer' },
  parameters: { storyFrame: 'monitor', layout: 'fullscreen' },
  globals: { width: 'phone-375' },
} satisfies Meta<typeof TaskAttachScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

const button = /タスクを添付|Attach task/;
const textOf = (el: HTMLElement) => (within(el).getByRole('textbox') as HTMLTextAreaElement).value;

/** Option A, composer: the new button sits right of "Image". Tap it to open the picker (a list with checkboxes, search and an Attach (N) confirm). */
export const SheetPopoverComposer: Story = {
  args: { option: 'sheet', stage: 'composer' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: button })).toBeVisible();
  },
};

/** Option A, picker open: a list with checkboxes, search and an Attach (N) confirm. */
export const SheetPopoverPicker: Story = {
  args: { option: 'sheet', stage: 'picker' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('dialog', {
        name: /タスクを添付|Attach tasks/,
      }),
    ).toBeVisible();
  },
};

/** Option A, result: the request ends with the single last line "#552 #651". */
export const SheetPopoverResult: Story = {
  args: { option: 'sheet', stage: 'result' },
  play: async ({ canvasElement }) => {
    await expect(textOf(canvasElement)).toMatch(/\n#552 #651$/);
  },
};

/** Option B, composer: the new button sits right of "Image". Tap it to open the picker (typing # on the last line suggests tasks in place). */
export const InlineHashComposer: Story = {
  args: { option: 'inline', stage: 'composer' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: button })).toBeVisible();
  },
};

/** Option B, picker open: typing # on the last line suggests tasks in place. */
export const InlineHashPicker: Story = {
  args: { option: 'inline', stage: 'picker' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('listbox')).toBeVisible();
  },
};

/** Option B, result: the request ends with the single last line "#552 #651". */
export const InlineHashResult: Story = {
  args: { option: 'inline', stage: 'result' },
  play: async ({ canvasElement }) => {
    await expect(textOf(canvasElement)).toMatch(/\n#552 #651$/);
  },
};

/** Option C, composer: the new button sits right of "Image". Tap it to open the picker (a full-screen picker grouped by lane). */
export const FullScreenComposer: Story = {
  args: { option: 'full', stage: 'composer' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: button })).toBeVisible();
  },
};

/** Option C, picker open: a full-screen picker grouped by lane. */
export const FullScreenPicker: Story = {
  args: { option: 'full', stage: 'picker' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('dialog', {
        name: /タスクを添付|Attach tasks/,
      }),
    ).toBeVisible();
  },
};

/** Option C, result: the request ends with the single last line "#552 #651". */
export const FullScreenResult: Story = {
  args: { option: 'full', stage: 'result' },
  play: async ({ canvasElement }) => {
    await expect(textOf(canvasElement)).toMatch(/\n#552 #651$/);
  },
};

/** Re-opening on a request that already ends with "#552 #651" replaces that line instead of adding a second one. */
export const ReeditReplacesLine: Story = {
  args: { option: 'sheet', stage: 'result' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: button }));
    await userEvent.click(c.getByRole('checkbox', { name: '#651' }));
    await userEvent.click(c.getByRole('button', { name: /添付 \(1\)|Attach \(1\)/ }));
    const value = textOf(canvasElement);
    await expect(value.match(/#552/g)).toHaveLength(1);
    await expect(value.endsWith('\n#552')).toBe(true);
  },
};
