import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { ProgressTaskRenderer } from './EpicProgressList';
import { makeEpic, makeTask } from '../../../../.storybook/support/fixtures';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { EpicDialog } from './EpicDialog';

const meta: Meta<typeof EpicDialog> = {
  title: 'Epic/Editor/EpicDialog',
  component: EpicDialog,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
};

const epic = makeEpic({
  id: 'planning',
  name: 'Planning',
  color: '#7c3aed',
  body: '## Goal\n\nKeep the board predictable.\n\n## Steps\n\nReview and ship.',
  plan: '## Goal\n\nKeep the board predictable.\n\n## Steps\n\nReview and ship.',
  priority: [12, 10],
  attachments: [
    {
      id: '0123456789abcdef0123456789abcdef',
      name: 'sample-attachment.png',
      mediaType: 'image/png',
      size: 512,
      createdAt: '2026-10-02T09:00:00.000Z',
    },
  ],
});
const tasks = [
  makeTask({ id: 10, title: 'Write the plan', epic: epic }),
  makeTask({ id: 12, title: 'Review the plan', epic: epic, taskStatus: 'doing' }),
  makeTask({ id: 14, title: 'Unrelated task' }),
];
const renderTask: ProgressTaskRenderer = (task, row) => (
  <div className="card__top">
    {row.grip}
    <span className="card__id">#{task.id}</span>
    <button
      type="button"
      className="epic-progress__name"
      disabled={row.disabled}
      onClick={row.onOpen}
    >
      {task.title}
    </button>
  </div>
);

function saveDetailsFailsOnce() {
  let shouldFail = true;
  return fn(async () => {
    if (shouldFail) {
      shouldFail = false;
      throw new Error('temporary failure');
    }
  });
}

meta.args = {
  epic,
  tasks,
  projectId: 'sample-project',
  renderTask,
  api: {
    addImages: fn(async () => {}),
    removeImage: fn(async () => {}),
    savePlan: fn(async () => {}),
    saveDetails: fn(async () => {}),
    savePriority: fn(async () => {}),
    remove: fn(async () => {}),
  },
  onOpenTask: fn(),
  onClose: fn(),
};

export default meta;
type Story = StoryObj<typeof meta>;

/** The untouched epic uses its stored name, plan, image and task order. */
export const Unchanged: Story = {
  play: async () => {
    const view = within(document.body);
    await expect(view.getByLabelText('Title')).toHaveValue('Planning');
    await expect(view.getByText('Keep the board predictable.')).toBeInTheDocument();
    await expect(view.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(view.getByRole('button', { name: /Review the plan/ })).toBeInTheDocument();
  },
};

/** Japanese epic editing uses the same title field with its localized label. */
export const JapaneseLabel: Story = {
  globals: { locale: 'ja' },
  play: async () => {
    const view = within(document.body);
    await expect(view.getByLabelText('タイトル')).toHaveValue('Planning');
  },
};

/** The controller preserves the typed name through a failed save and retries the unsaved step. */
export const DetailsSaveRetry: Story = {
  args: {
    api: {
      addImages: fn(async () => {}),
      removeImage: fn(async () => {}),
      savePlan: fn(async () => {}),
      saveDetails: saveDetailsFailsOnce(),
      savePriority: fn(async () => {}),
      remove: fn(async () => {}),
    },
  },
  play: async ({ args }) => {
    const view = within(document.body);
    const name = view.getByLabelText('Title');
    await userEvent.clear(name);
    await userEvent.type(name, 'Updated plan');
    await userEvent.click(view.getByRole('button', { name: 'Save' }));
    await expect(args.api.saveDetails).toHaveBeenCalledTimes(1);
    await expect(await within(document.body).findByRole('alert')).toHaveTextContent(
      'Could not save the name, color or draft.',
    );
    await expect(name).toHaveValue('Updated plan');
    await userEvent.click(within(document.body).getByRole('button', { name: 'Retry' }));
    await expect(args.api.saveDetails).toHaveBeenCalledTimes(2);
    await expect(within(document.body).queryByRole('alert')).toBeNull();
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};
