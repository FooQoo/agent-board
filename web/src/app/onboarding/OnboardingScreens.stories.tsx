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
export const RequestToSend: Story = { args: { kind: 'request' } };
export const PlanMade: Story = { args: { kind: 'planned' } };
export const DecisionNeeded: Story = { args: { kind: 'question' } };

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
  args: { kind: 'question' },
  decorators: [
    (Story) => (
      <DarkTheme>
        <Story />
      </DarkTheme>
    ),
  ],
};
export const PlanStarted: Story = { args: { kind: 'started' } };
export const CardsDone: Story = { args: { kind: 'done' } };
export const Completed: Story = { args: { kind: 'complete' } };
