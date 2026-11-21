import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BULK_WIDTH, OVERSCROLL_DISTANCE, useLaneOverscroll } from './useLaneOverscroll';

afterEach(cleanup);

function Host({
  enabled,
  onOverscroll,
  chosen,
  onIgnoredClick,
  direction,
}: {
  direction?: -1 | 1;
  enabled: boolean;
  onOverscroll: () => void;
  chosen?: boolean;
  onIgnoredClick?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lane = useLaneOverscroll(ref, enabled, onOverscroll, direction);
  return (
    <div
      ref={ref}
      data-testid="lane"
      data-offset={lane.offset}
      onClickCapture={lane.onClickCapture}
      {...lane.handlers}
    >
      <div data-testid="plain" />
      {chosen && <div data-testid="chosen" data-swipe-card="" data-armed="" />}
      <button type="button" data-testid="tile" data-swipe-action />
      <button type="button" data-testid="ignored" data-lane-ignore onClick={onIgnoredClick} />
    </div>
  );
}

let time = 0;
function pointer(target: Element, type: string, x: number, y = 0) {
  time += 16;
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  for (const [key, value] of Object.entries({ isPrimary: true, pointerId: 1, timeStamp: time }))
    Object.defineProperty(event, key, { value });
  act(() => {
    fireEvent(target, event);
  });
}

/** The finger goes down at x = 200, moves left by `dx` in steps (and `dy` down), and lifts. */
function swipe(target: Element, dx: number, dy = 0) {
  pointer(target, 'pointerdown', 200);
  for (const step of [0.25, 0.5, 0.75, 1])
    pointer(target, 'pointermove', 200 + dx * step, dy * step);
  pointer(target, 'pointerup', 200 + dx, dy);
}

describe('useLaneOverscroll', () => {
  const setup = (enabled = true, chosen = false) => {
    const onOverscroll = vi.fn();
    const onIgnoredClick = vi.fn();
    const view = render(
      <Host
        enabled={enabled}
        onOverscroll={onOverscroll}
        chosen={chosen}
        onIgnoredClick={onIgnoredClick}
      />,
    );
    return {
      onOverscroll,
      onIgnoredClick,
      lane: view.getByTestId('lane'),
      plain: view.getByTestId('plain'),
      chosen: view.queryByTestId('chosen'),
      tile: view.getByTestId('tile'),
      ignored: view.getByTestId('ignored'),
    };
  };

  it('fires for a long swipe to the left, and the lane springs back', () => {
    const { onOverscroll, lane, plain } = setup();
    swipe(plain, -OVERSCROLL_DISTANCE);
    expect(onOverscroll).toHaveBeenCalledOnce();
    expect(lane.dataset.offset).toBe('0');
  });

  // #627: the Archive all button is a control the hook ignores; an earlier swipe must not eat its tap.
  it('lets a tap on an ignored control click after an earlier swipe', () => {
    const { plain, ignored, onIgnoredClick } = setup();
    swipe(plain, -(OVERSCROLL_DISTANCE - 10));
    pointer(ignored, 'pointerdown', 200);
    pointer(ignored, 'pointerup', 200);
    fireEvent.click(ignored);
    expect(onIgnoredClick).toHaveBeenCalledOnce();
  });

  it('follows the finger, then takes a quarter of the drag beyond the tile', () => {
    const { lane, plain } = setup();
    pointer(plain, 'pointerdown', 200);
    pointer(plain, 'pointermove', 180);
    pointer(plain, 'pointermove', 170);
    expect(lane.dataset.offset).toBe('-30');
    pointer(plain, 'pointermove', 200 - BULK_WIDTH - 40);
    expect(lane.dataset.offset).toBe(String(-BULK_WIDTH - 10));
    pointer(plain, 'pointerup', 200 - BULK_WIDTH - 40);
  });

  it('ignores a short swipe, a swipe to the right and a mostly vertical one', () => {
    const { onOverscroll, lane, plain } = setup();
    swipe(plain, -(OVERSCROLL_DISTANCE - 10));
    expect(lane.dataset.offset).toBe('0');
    swipe(plain, OVERSCROLL_DISTANCE * 2);
    swipe(plain, -OVERSCROLL_DISTANCE, OVERSCROLL_DISTANCE * 2);
    expect(onOverscroll).not.toHaveBeenCalled();
    expect(lane.dataset.offset).toBe('0');
  });

  it('does nothing when it is not the last lane, on a chosen card, or on a tile', () => {
    const off = setup(false);
    swipe(off.plain, -OVERSCROLL_DISTANCE * 2);
    expect(off.onOverscroll).not.toHaveBeenCalled();
    expect(off.lane.dataset.offset).toBe('0');
    cleanup();
    const on = setup();
    swipe(on.tile, -OVERSCROLL_DISTANCE * 2);
    expect(on.onOverscroll).not.toHaveBeenCalled();
    cleanup();
    const chosen = setup(true, true);
    swipe(chosen.chosen as Element, -OVERSCROLL_DISTANCE * 2);
    swipe(chosen.plain, -OVERSCROLL_DISTANCE * 2);
    expect(chosen.onOverscroll).not.toHaveBeenCalled();
  });

  describe('touch moves for the outer area', () => {
    const touchMove = (target: Element, x: number) => {
      const event = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: 0 }] });
      act(() => {
        target.dispatchEvent(event);
      });
    };

    it('reaches an ancestor once the press is judged vertical, even drifting left', () => {
      const { lane, plain } = setup();
      const seen = vi.fn();
      lane.parentElement?.addEventListener('touchmove', seen);
      touchMove(plain, 195); // no press yet
      pointer(plain, 'pointerdown', 200);
      pointer(plain, 'pointermove', 196, 20); // clearly vertical
      touchMove(plain, 196);
      touchMove(plain, 190);
      expect(seen).toHaveBeenCalledTimes(3);
    });

    it('is still stopped while sliding to the left', () => {
      const { lane, plain } = setup();
      const seen = vi.fn();
      lane.parentElement?.addEventListener('touchmove', seen);
      pointer(plain, 'pointerdown', 200);
      pointer(plain, 'pointermove', 170);
      touchMove(plain, 170);
      expect(seen).not.toHaveBeenCalled();
      pointer(plain, 'pointerup', 170);
    });
  });
});

// The Backlog's mirror of the Done lane's gesture: a swipe to the right past the first lane.
describe('useLaneOverscroll to the right', () => {
  const setup = () => {
    const onOverscroll = vi.fn();
    const view = render(<Host enabled direction={1} onOverscroll={onOverscroll} />);
    return { onOverscroll, lane: view.getByTestId('lane'), plain: view.getByTestId('plain') };
  };

  it('fires for a long swipe to the right, and the lane springs back', () => {
    const { onOverscroll, lane, plain } = setup();
    swipe(plain, OVERSCROLL_DISTANCE);
    expect(onOverscroll).toHaveBeenCalledOnce();
    expect(lane.dataset.offset).toBe('0');
  });

  it('follows the finger to the right, then takes a quarter of the drag beyond the tile', () => {
    const { lane, plain } = setup();
    pointer(plain, 'pointerdown', 200);
    pointer(plain, 'pointermove', 220);
    pointer(plain, 'pointermove', 230);
    expect(lane.dataset.offset).toBe('30');
    pointer(plain, 'pointermove', 200 + BULK_WIDTH + 40);
    expect(lane.dataset.offset).toBe(String(BULK_WIDTH + 10));
    pointer(plain, 'pointerup', 200 + BULK_WIDTH + 40);
  });

  it('ignores a short swipe, a swipe to the left and a mostly vertical one', () => {
    const { onOverscroll, lane, plain } = setup();
    swipe(plain, OVERSCROLL_DISTANCE - 10);
    swipe(plain, -OVERSCROLL_DISTANCE * 2);
    swipe(plain, OVERSCROLL_DISTANCE, OVERSCROLL_DISTANCE * 2);
    expect(onOverscroll).not.toHaveBeenCalled();
    expect(lane.dataset.offset).toBe('0');
  });
});
