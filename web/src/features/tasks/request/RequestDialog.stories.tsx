import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { makeEpic } from '../../../../.storybook/support/fixtures';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { RequestDialog } from './RequestDialog';

const epics = [makeEpic({ id: 'release', name: 'Release' })];
const meta: Meta<typeof RequestDialog> = {
  title: 'Task/Dialogs/RequestDialog',
  component: RequestDialog,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  args: {
    epics,
    onClose: fn(),
    onSubmit: fn(async () => {}),
    onCreateManually: fn(),
    renderEpic: (epic, className) => <span className={className}>{epic.name}</span>,
  },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const RequestSubmit: Story = {
  play: async ({ args }) => {
    const view = within(document.body);
    const input = view.getByLabelText('What should be done?');
    await userEvent.type(input, 'Review the release plan');
    await userEvent.click(view.getByRole('button', { name: 'Submit task' }));
    await expect(args.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Review the release plan',
        requestKind: 'simple',
        epicId: null,
      }),
    );
  },
};
export const SelectEpic: Story = {
  play: async ({ args }) => {
    const view = within(document.body);
    await userEvent.type(view.getByLabelText('What should be done?'), 'Review the release plan');
    await userEvent.click(view.getByRole('button', { name: 'Epic (optional)' }));
    await expect(view.getByRole('menuitemradio', { name: 'Release' })).toBeInTheDocument();
    await userEvent.click(view.getByRole('menuitemradio', { name: 'Release' }));
    await expect(view.getByRole('button', { name: 'Epic (optional)' })).toHaveTextContent(
      'Release',
    );
    await userEvent.click(view.getByRole('button', { name: 'Submit task' }));
    await expect(args.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ epicId: 'release', description: 'Review the release plan' }),
    );
  },
};
export const ClearEpicSelection: Story = {
  play: async ({ args }) => {
    const view = within(document.body);
    await userEvent.type(view.getByLabelText('What should be done?'), 'Review the release plan');
    await userEvent.click(view.getByRole('button', { name: 'Epic (optional)' }));
    await userEvent.click(view.getByRole('menuitemradio', { name: 'Release' }));
    await userEvent.click(view.getByRole('button', { name: 'Epic (optional)' }));
    await userEvent.click(view.getByRole('menuitemradio', { name: 'No epic' }));
    await expect(view.getByRole('button', { name: 'Epic (optional)' })).toHaveTextContent(
      'No epic',
    );
    await userEvent.click(view.getByRole('button', { name: 'Submit task' }));
    await expect(args.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ epicId: null, description: 'Review the release plan' }),
    );
  },
};
export const ManualRouteAfterDiscard: Story = {
  play: async ({ args }) => {
    const view = within(document.body);
    await userEvent.type(view.getByLabelText('What should be done?'), 'Keep this request');
    await userEvent.click(view.getByRole('button', { name: 'Create manually' }));
    await userEvent.click(view.getByRole('button', { name: 'Discard and close' }));
    await expect(args.onCreateManually).toHaveBeenCalledTimes(1);
  },
};
export const EpicFetchFailure: Story = { args: { epicsFetchFailed: true } };
