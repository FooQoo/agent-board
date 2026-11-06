import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { makeProject, makeTask } from '../../../../.storybook/support/fixtures';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { noOperations } from '@/shared/lib/operations/operations';
import { DecisionAnswerDialogContainer } from './DecisionAnswerDialogContainer';
import { useTaskAnswers } from './model/useTaskAnswers';

const TITLE = 'API refactor';
const task = makeTask({
  id: 11,
  title: TITLE,
  taskStatus: 'doing',
  agentStatus: 'pending',
  pendingRequestId: 'request-11',
  pendingReason: 'Which way should the board go?',
  pendingChoices: [
    { id: 'keep', label: 'Keep the data' },
    { id: 'reset', label: 'Start over' },
  ],
});

interface HarnessProps {
  /** The card as the board lists it; null once it is gone. */
  listed: typeof task | null;
  onClose: () => void;
}

/** The dialog with the board's answer drafts behind it, as the app holds them. */
function Harness({ listed, onClose }: HarnessProps) {
  const answers = useTaskAnswers(() => {});
  return (
    <DecisionAnswerDialogContainer
      projectId={makeProject().id}
      taskId={task.id}
      task={listed}
      answers={answers}
      operations={noOperations}
      syncedAt={null}
      onClose={onClose}
    />
  );
}

const meta = {
  title: 'Task/Answer/DecisionAnswerDialogContainer',
  component: Harness,
  args: { listed: task, onClose: fn() },
  parameters: { ...modalDocsParameters, layout: 'fullscreen' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

/** The card's question and options are drawn in the dialog. */
export const Open: Story = {
  play: async () => {
    await expect(await page().findByRole('dialog', { name: /API refactor/ })).toBeInTheDocument();
    await expect(await page().findByText('Which way should the board go?')).toBeInTheDocument();
    await expect(page().getAllByRole('radio')).toHaveLength(2);
  },
};
