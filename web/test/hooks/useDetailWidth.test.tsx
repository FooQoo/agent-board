import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDetailWidth } from '../../src/hooks/useDetailWidth';

function makeBody(width: number) {
  const body = document.createElement('div');
  const lanes = document.createElement('div');
  lanes.className = 'board__lanes';
  body.append(lanes);
  document.body.append(body);
  let bodyWidth = width;
  body.getBoundingClientRect = () => ({ width: bodyWidth }) as DOMRect;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    () => ({ paddingLeft: '24px', paddingRight: '24px', columnGap: '12px' }) as unknown as CSSStyleDeclaration,
  );
  return {
    ref: { current: body },
    setWidth: (w: number) => {
      bodyWidth = w;
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
    },
  };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.body.className = '';
});

describe('useDetailWidth', () => {
  it('starts from the stored width, else 360', () => {
    const { ref } = makeBody(1600);
    expect(renderHook(() => useDetailWidth(ref, true)).result.current.width).toBe(360);
    window.localStorage.setItem('skan.detailWidth', '480');
    expect(renderHook(() => useDetailWidth(ref, true)).result.current.width).toBe(480);
  });

  it('widens by dragging left, narrows right, stops at the ends, saves once', () => {
    const { ref } = makeBody(1600);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useDetailWidth(ref, true));
    act(() => result.current.startDrag(500));
    expect(document.body.classList.contains('is-resizing')).toBe(true);
    act(() => result.current.moveDrag(400));
    expect(result.current.width).toBe(460);
    act(() => result.current.moveDrag(0));
    expect(result.current.width).toBe(560);
    act(() => result.current.moveDrag(5000));
    expect(result.current.width).toBe(280);
    act(() => result.current.moveDrag(430));
    expect(setItem).not.toHaveBeenCalled();
    act(() => result.current.endDrag());
    act(() => result.current.endDrag());
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('skan.detailWidth')).toBe(String(result.current.width));
    expect(document.body.classList.contains('is-resizing')).toBe(false);
  });

  it('keeps the dragged width when saving fails', () => {
    const { ref } = makeBody(1600);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const { result } = renderHook(() => useDetailWidth(ref, true));
    act(() => result.current.startDrag(500));
    act(() => result.current.moveDrag(420));
    act(() => result.current.endDrag());
    expect(result.current.width).toBe(440);
  });

  it('fits a shrinking layout and returns to the chosen width when it grows', () => {
    const { ref, setWidth } = makeBody(1600);
    window.localStorage.setItem('skan.detailWidth', '500');
    const { result } = renderHook(() => useDetailWidth(ref, true));
    expect(result.current.width).toBe(500);
    setWidth(1024);
    expect(result.current.width).toBe(352);
    expect(window.localStorage.getItem('skan.detailWidth')).toBe('500');
    setWidth(1600);
    expect(result.current.width).toBe(500);
  });
});
