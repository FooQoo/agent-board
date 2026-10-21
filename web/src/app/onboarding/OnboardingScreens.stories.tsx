import { useEffect, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { OnboardingMockScreen } from './OnboardingMockScreen';

const meta = {
  title: 'App/Onboarding/Mock screens',
  component: OnboardingMockScreen,
  parameters: { layout: 'fullscreen' },
  args: { kind: 'welcome' },
} satisfies Meta<typeof OnboardingMockScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Welcome: Story = {
  args: { kind: 'welcome' },
  play: async () => {
    await expect(within(document.body).getByRole('dialog')).toBeInTheDocument();
  },
};
export const SamplesCreated: Story = { args: { kind: 'samples' } };
export const AutomaticProgress: Story = { args: { kind: 'running' } };
export const DecisionNeeded: Story = { args: { kind: 'pending' } };

/** Mock screen 08: the same decision screen in the dark theme. */
function DarkTheme({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const before = root.dataset.mode;
    root.dataset.mode = 'dark';
    return () => {
      if (before) root.dataset.mode = before;
      else delete root.dataset.mode;
    };
  }, []);
  return children;
}

export const DecisionNeededDark: Story = {
  args: { kind: 'pending' },
  decorators: [
    (Story) => (
      <DarkTheme>
        <Story />
      </DarkTheme>
    ),
  ],
};
export const ResumedAfterAnswer: Story = { args: { kind: 'resumed' } };
export const Completed: Story = { args: { kind: 'complete' } };
export const Archived: Story = { args: { kind: 'archived' } };
