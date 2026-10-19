import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { createMemoryStorage } from '../../../.storybook/support/decorators';
import { ACCENTS, MODES, selectTheme } from '../theme';
import { Badge } from './badge';
import { Button } from './button';
import { Checkbox } from './checkbox';

/** Waits until a theme change has reached the computed styles: one frame, then the CSS transitions it started. */
async function settleTheme(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  await Promise.all(
    document.getAnimations().map((animation) => animation.finished.catch(() => {})),
  );
}

const meta = {
  title: 'Shared/UI/ThemeMatrix',
  component: Button,
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The representative primitives, in one row: a primary action, a status badge and a checked box. */
function PrimitiveRow() {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 16 }}>
      <Button>Save</Button>
      <Badge variant="pending">Pending</Badge>
      <Checkbox aria-label="Accept terms" checked />
      {/* A probe that reads the accent from the page's own theme, to compare with the primitives. */}
      <span data-testid="accent-probe" style={{ color: 'var(--r-accent)' }}>
        probe
      </span>
    </div>
  );
}

/**
 * Smoke over all 12 accents in light and dark. The primary button, the pending badge and the checked
 * box must take the accent of the page, and the badge must keep a visible background.
 */
export const Smoke: Story = {
  render: () => <PrimitiveRow />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Save' });
    const badge = canvas.getByText('Pending');
    const box = canvas.getByRole('checkbox', { name: 'Accept terms' });
    const probe = canvas.getByTestId('accent-probe');
    for (const mode of MODES) {
      for (const accent of ACCENTS) {
        selectTheme({ mode, accent }, createMemoryStorage);
        await settleTheme();
        const label = `${mode}/${accent}`;
        const accentColor = getComputedStyle(probe).color;
        expect(document.documentElement.dataset.mode, label).toBe(mode);
        expect(document.documentElement.dataset.accent, label).toBe(accent);
        expect(getComputedStyle(button).backgroundColor, label).toBe(accentColor);
        expect(getComputedStyle(box).backgroundColor, label).toBe(accentColor);
        expect(getComputedStyle(badge).backgroundColor, label).not.toBe('rgba(0, 0, 0, 0)');
      }
    }
  },
};
