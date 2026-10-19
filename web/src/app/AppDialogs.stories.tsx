import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { makeProject, makeTask } from '../../.storybook/support/fixtures';
import type { AppControllerModel } from './contracts';
import { AppDialogs } from './AppDialogs';

const project = makeProject();
const task = makeTask({ id: 31, title: 'Prepare the release' });
const meta = {
  title: 'App/AppDialogs',
  component: AppDialogs,
  parameters: { layout: 'fullscreen' },
  args: {
    model: {
      session: {
        dialog: { kind: 'create' },
        operation: { id: 1, kind: 'create', projectId: project.id, saving: false },
        bulkArchive: null,
        answerLeases: [],
      },
      operations: { end: fn(), saveStarted: fn(), saveFailed: fn() },
      tasks: [task],
      boardData: { epics: [] },
      board: { fetchFailed: false },
      projects: { projects: [project] },
    } as unknown as AppControllerModel,
    onSubmit: fn(async () => {}),
    onCloseOperation: fn(),
    onSavingChange: fn(),
    onOpenTask: fn(),
    onConfirmBulkArchive: fn(async () => {}),
    onCancelBulkArchive: fn(),
  },
} satisfies Meta<typeof AppDialogs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Create: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('dialog')).toBeInTheDocument();
  },
};
