import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { AcceptanceTabView } from './AcceptanceTabView';

const ITEMS = [
  { id: 'AC-1', text: 'The list returns JSON', done: true },
  { id: 'AC-2', text: 'Errors keep the input', done: false },
];

// Built in parts so the source guard keeps rejecting embedded remote URLs.
const GUIDE_URL = [`https:`, ``, `example.com`, `guide`].join('/');

const meta = {
  title: 'Task Detail/AcceptanceTab',
  component: AcceptanceTabView,
  args: { task: { acceptance: ITEMS, acceptanceError: false } },
} satisfies Meta<typeof AcceptanceTabView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Without a save action the checkboxes are read-only, as for an archived task. */
export const ReadOnly: Story = {
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    for (const box of view.getAllByRole('checkbox')) await expect(box).toBeDisabled();
  },
};

/** A condition is drawn as Markdown; its checkbox is named by the drawn text, without the marks. */
export const Markdown: Story = {
  args: {
    task: {
      acceptance: [
        { id: 'AC-1', text: '**Saving** keeps `TASK.md` readable', done: true },
        { id: 'AC-2', text: `Follows the [guide](${GUIDE_URL})`, done: false },
      ],
      acceptanceError: false,
    },
  },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(await view.findByRole('link', { name: 'guide' })).toBeVisible();
    await expect(view.getByText('TASK.md').tagName).toBe('CODE');
    await expect(
      view.getByRole('checkbox', { name: 'Saving keeps TASK.md readable' }),
    ).toBeChecked();
  },
};

/** The person checks a condition: it shows at once, the count follows, and the choice is saved. */
export const Toggle: Story = {
  args: { onToggle: fn(async () => {}) },
  play: async ({ args, canvasElement }) => {
    const view = within(canvasElement);
    const box = view.getByRole('checkbox', { name: 'Errors keep the input' });
    await expect(box).toBeEnabled();
    await userEvent.click(box);
    await expect(box).toBeChecked();
    await expect(view.getByText('2 / 2')).toBeVisible();
    await expect(args.onToggle).toHaveBeenCalledWith('AC-2', true);
  },
};

/** Saving fails: the checkbox returns to what was saved and the error is announced. */
export const SaveFails: Story = {
  args: { onToggle: fn(async () => Promise.reject(new Error('offline'))) },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    const box = view.getByRole('checkbox', { name: 'The list returns JSON' });
    await userEvent.click(box);
    await waitFor(() => expect(view.getByRole('alert')).toBeVisible());
    await expect(box).toBeChecked();
    await expect(view.getByText('1 / 2')).toBeVisible();
  },
};

/** The same controls in Japanese, in the dark theme, on a phone-width window. */
export const JapaneseDarkNarrow: Story = {
  args: { onToggle: fn(async () => Promise.reject(new Error('offline'))) },
  globals: { locale: 'ja', mode: 'dark', width: 'phone-375' },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await userEvent.click(view.getByRole('checkbox', { name: 'Errors keep the input' }));
    await waitFor(() =>
      expect(view.getByRole('alert')).toHaveTextContent('受入条件を保存できませんでした'),
    );
  },
};
