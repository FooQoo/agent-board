import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OVERSCROLL_DISTANCE, useLaneOverscroll } from './useLaneOverscroll';

afterEach(cleanup);

function Host({ enabled, onOverscroll }: { enabled: boolean; onOverscroll: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLaneOverscroll(ref, enabled, onOverscroll);
  return (
    <div ref={ref} data-testid="viewport">
      <div data-testid="plain" />
      <div data-testid="chosen" data-swipe-card="" data-armed="" />
    </div>
  );
}

function pointer(target: Element, type: string, x: number, y = 0) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'isPrimary', { value: true });
  target.dispatchEvent(event);
}

function swipe(target: Element, dx: number, dy = 0) {
  pointer(target, 'pointerdown', 200);
  pointer(target, 'pointerup', 200 + dx, dy);
}

describe('useLaneOverscroll', () => {
  const setup = (enabled = true) => {
    const onOverscroll = vi.fn();
    const view = render(<Host enabled={enabled} onOverscroll={onOverscroll} />);
    return { onOverscroll, plain: view.getByTestId('plain'), chosen: view.getByTestId('chosen') };
  };

  it('fires for a long swipe to the left', () => {
    const { onOverscroll, plain } = setup();
    swipe(plain, -OVERSCROLL_DISTANCE);
    expect(onOverscroll).toHaveBeenCalledOnce();
  });

  it('ignores a short swipe, a swipe to the right and a mostly vertical one', () => {
    const { onOverscroll, plain } = setup();
    swipe(plain, -(OVERSCROLL_DISTANCE - 10));
    swipe(plain, OVERSCROLL_DISTANCE * 2);
    swipe(plain, -OVERSCROLL_DISTANCE, OVERSCROLL_DISTANCE);
    expect(onOverscroll).not.toHaveBeenCalled();
  });

  it('does nothing when it is not the last lane, or on a chosen card', () => {
    const off = setup(false);
    swipe(off.plain, -OVERSCROLL_DISTANCE * 2);
    expect(off.onOverscroll).not.toHaveBeenCalled();
    cleanup();
    const on = setup();
    swipe(on.chosen, -OVERSCROLL_DISTANCE * 2);
    expect(on.onOverscroll).not.toHaveBeenCalled();
  });
});
