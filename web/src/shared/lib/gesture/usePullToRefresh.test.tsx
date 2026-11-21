import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { usePullToRefresh } from './usePullToRefresh';

function Harness({ onRefresh }: { onRefresh: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const { state, offset } = usePullToRefresh({
    container,
    scroller: (root) => root.querySelector<HTMLElement>('[data-scroll]'),
    onRefresh,
  });
  return (
    <div ref={container}>
      <div data-scroll data-testid="list" />
      <output data-testid="state">{`${state}:${offset}`}</output>
    </div>
  );
}

function fire(type: string, target: Element, y: number, x = 100) {
  const touches = type === 'touchend' ? [] : [{ clientX: x, clientY: y }];
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { touches });
  act(() => {
    target.dispatchEvent(event);
  });
}

describe('usePullToRefresh', () => {
  it('refreshes when a pull from the top of the given scroller passes the threshold', () => {
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} />);
    const list = screen.getByTestId('list');
    fire('touchstart', list, 10);
    fire('touchmove', list, 50);
    fire('touchmove', list, 130);
    expect(screen.getByTestId('state').textContent).toBe('ready:60');
    fire('touchend', list, 130);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('does not refresh on a short pull, a sideways drag, or a touch outside the scroller', () => {
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} />);
    const list = screen.getByTestId('list');
    fire('touchstart', list, 10);
    fire('touchmove', list, 40);
    fire('touchend', list, 40);
    fire('touchstart', list, 10, 200);
    fire('touchmove', list, 20, 120);
    fire('touchmove', list, 80, 40);
    fire('touchend', list, 80, 40);
    const outside = screen.getByTestId('state');
    fire('touchstart', outside, 10);
    fire('touchmove', outside, 130);
    fire('touchend', outside, 130);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
