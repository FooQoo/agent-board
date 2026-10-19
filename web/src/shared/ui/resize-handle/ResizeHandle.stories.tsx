import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { ResizeHandle } from './ResizeHandle';

const meta = {
  title: 'Shared/UI/ResizeHandle',
  component: ResizeHandle,
  args: { startDrag: fn(), moveDrag: fn(), endDrag: fn() },
} satisfies Meta<typeof ResizeHandle>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The separator between the board and the detail column: a labelled vertical handle with three grips. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const handle = within(canvasElement).getByRole('separator', {
      name: 'Resize task details',
    });
    await expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    await expect(handle.querySelectorAll('.resize-handle__grip')).toHaveLength(3);
  },
};

/** Moving the pointer over the handle reports the new x position, and releasing it ends the drag. */
export const DragCallbacks: Story = {
  play: async ({ args, canvasElement }) => {
    const handle = within(canvasElement).getByRole('separator');
    handle.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 80, pointerId: 1 }),
    );
    await expect(args.moveDrag).toHaveBeenCalledWith(80);
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    await expect(args.endDrag).toHaveBeenCalledTimes(1);
  },
};
