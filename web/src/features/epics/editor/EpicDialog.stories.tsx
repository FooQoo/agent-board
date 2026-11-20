import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { ProgressTaskRenderer } from './progressTypes';
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
  document: '## Goal\n\nKeep the board predictable.\n\n## Steps\n\nReview and ship.',
  waves: [[12], [10]],
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

function saveFailsOnce() {
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
    save: fn(async () => {}),
    saveWaves: fn(async () => {}),
    enterDraft: fn(async () => ({ ...epic, draft: 'human' as const })),
    leaveDraft: fn(async () => {}),
    remove: fn(async () => {}),
  },
  onOpenTask: fn(),
  onClose: fn(),
};

export default meta;
type Story = StoryObj<typeof meta>;

/** The untouched epic uses its stored name, epic details, image and task order. */
export const Unchanged: Story = {
  play: async () => {
    const view = within(document.body);
    await expect(view.getByLabelText('Title')).toHaveValue('Planning');
    await expect(view.getByText('Keep the board predictable.')).toBeInTheDocument();
    await expect(view.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(view.getByText('Review the plan')).toBeInTheDocument();
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
      save: saveFailsOnce(),
      saveWaves: fn(async () => {}),
      enterDraft: fn(async () => ({ ...epic, draft: 'human' as const })),
      leaveDraft: fn(async () => {}),
      remove: fn(async () => {}),
    },
  },
  play: async ({ args }) => {
    const view = within(document.body);
    const name = view.getByLabelText('Title');
    await userEvent.clear(name);
    await userEvent.type(name, 'Updated plan');
    await waitFor(() => expect(view.getByRole('button', { name: 'Save' })).toBeEnabled());
    await userEvent.click(view.getByRole('button', { name: 'Save' }));
    await expect(args.api.save).toHaveBeenCalledTimes(1);
    await expect(await within(document.body).findByRole('alert')).toHaveTextContent(
      'Could not save the epic details.',
    );
    await expect(name).toHaveValue('Updated plan');
    await userEvent.click(within(document.body).getByRole('button', { name: 'Retry' }));
    await expect(args.api.save).toHaveBeenCalledTimes(2);
    await expect(within(document.body).queryByRole('alert')).toBeNull();
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

const waveEpic = makeEpic({
  id: 'planning',
  name: 'Planning',
  color: '#7c3aed',
  body: 'Waves.',
  document: 'Waves.',
  waves: [[10], [12], [14, 15, 16]],
});
const waveTasks = [
  makeTask({ id: 10, title: 'Write the plan', epic: waveEpic, taskStatus: 'done' }),
  makeTask({ id: 12, title: 'Review the plan', epic: waveEpic, taskStatus: 'doing' }),
  makeTask({ id: 14, title: 'Build the first part', epic: waveEpic }),
  makeTask({ id: 15, title: 'Build the second part', epic: waveEpic }),
  makeTask({ id: 16, title: 'Build the third part', epic: waveEpic }),
  makeTask({ id: 18, title: 'Tidy up later', epic: waveEpic }),
];

/** Waves stack top to bottom, parallel tasks sit side by side, and unlisted tasks follow. */
export const WaveOrder: Story = {
  args: { epic: waveEpic, tasks: waveTasks },
  play: async () => {
    const view = within(document.body);
    await expect(view.getByRole('listitem', { name: 'Wave 1' })).toHaveTextContent('Done');
    await expect(view.getByRole('listitem', { name: 'Wave 2' })).toHaveTextContent('In progress');
    const third = view.getByRole('listitem', { name: 'Wave 3' });
    await expect(third).toHaveTextContent('3 in parallel');
    await expect(third).toHaveTextContent('Waiting for #12');
    await expect(view.getByRole('listitem', { name: 'Not in a wave' })).toHaveTextContent(
      'Tidy up later',
    );
    await expect(view.getByText('Drop here for a new wave')).toBeInTheDocument();
  },
};

/** A task moves to the adjacent wave with the keyboard, and the new waves are saved. */
export const WaveKeyboardMove: Story = {
  args: {
    epic: waveEpic,
    tasks: waveTasks,
    api: {
      addImages: fn(async () => {}),
      removeImage: fn(async () => {}),
      save: fn(async () => {}),
      saveWaves: fn(async () => {}),
      enterDraft: fn(async () => ({ ...waveEpic, draft: 'human' as const })),
      leaveDraft: fn(async () => {}),
      remove: fn(async () => {}),
    },
  },
  play: async ({ args }) => {
    const view = within(document.body);
    // The dialog zooms in as it opens; the drag library measures the cards, so it waits for the end.
    await Promise.all(document.getAnimations().map((animation) => animation.finished));
    const card = document.querySelector<HTMLElement>('[data-task-id="14"]');
    card?.focus();
    // The drag library handles each key asynchronously, so each key waits for the previous one.
    const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
    await userEvent.keyboard('[Space]');
    await settle();
    await userEvent.keyboard('[ArrowUp]');
    await settle();
    await userEvent.keyboard('[Space]');
    await settle();
    await waitFor(() => expect(view.getByRole('button', { name: 'Save' })).toBeEnabled(), {
      timeout: 4000,
    });
    await userEvent.click(view.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(args.api.saveWaves).toHaveBeenCalled());
    const calls = (args.api.saveWaves as ReturnType<typeof fn>).mock.calls;
    const saved: number[][] = calls[0]?.[0] ?? [];
    // The task joined the wave above it; the unlisted task stays out of every wave.
    await expect(saved.find((wave) => wave.includes(14))).toContain(12);
    await expect([...saved.flat()].sort((a, b) => a - b)).toEqual([10, 12, 14, 15, 16]);
  },
};
