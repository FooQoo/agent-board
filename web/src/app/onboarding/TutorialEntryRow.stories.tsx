import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { TutorialEntryRow } from './TutorialEntryRow';

const meta = {
  title: 'App/Onboarding/TutorialEntryRow',
  component: TutorialEntryRow,
  parameters: { layout: 'fullscreen' },
  args: { onStart: fn() },
} satisfies Meta<typeof TutorialEntryRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The row the settings dialog shows to start the guide again, drawn in a settings-dialog frame. */
export const SettingsEntry: Story = {
  render: (args) => (
    <div className="modal settings-dialog" style={{ position: 'static', margin: '32px auto' }}>
      <TutorialEntryRow {...args} />
    </div>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Tutorial' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Try it' }));
    await expect(args.onStart).toHaveBeenCalledTimes(1);
  },
};
