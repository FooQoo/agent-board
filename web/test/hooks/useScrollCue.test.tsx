import { act, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { useScrollCue } from '../../src/hooks/useScrollCue';

function setMetrics(
  el: HTMLElement,
  m: { scrollHeight?: number; clientHeight?: number; scrollTop?: number },
) {
  for (const [k, v] of Object.entries(m))
    Object.defineProperty(el, k, { configurable: true, writable: true, value: v });
}

function Probe({ dep }: { dep: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const more = useScrollCue(ref, dep);
  return <div ref={ref} data-testid="box" data-more={more ? 'true' : 'false'} />;
}

describe('useScrollCue', () => {
  it('is true when content overflows below, false at the bottom, and false when it fits', () => {
    const { getByTestId, rerender } = render(<Probe dep={1} />);
    const box = getByTestId('box');
    expect(box.dataset.more).toBe('false');

    setMetrics(box, { scrollHeight: 500, clientHeight: 200, scrollTop: 0 });
    rerender(<Probe dep={2} />);
    expect(box.dataset.more).toBe('true');

    setMetrics(box, { scrollHeight: 500, clientHeight: 200, scrollTop: 300 });
    act(() => {
      fireEvent.scroll(box);
    });
    expect(box.dataset.more).toBe('false');

    setMetrics(box, { scrollTop: 100 });
    act(() => {
      fireEvent.scroll(box);
    });
    expect(box.dataset.more).toBe('true');

    setMetrics(box, { scrollHeight: 200, clientHeight: 200, scrollTop: 0 });
    rerender(<Probe dep={3} />);
    expect(box.dataset.more).toBe('false');
  });
});
