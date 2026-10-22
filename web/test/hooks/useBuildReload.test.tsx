import { renderHook } from '@testing-library/react';
import { PresentationGate } from '../../src/shared/data/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBuildReload } from '../../src/app/model/useBuildReload';

const OWN = '0123456789abcdef';
const NEW = 'fedcba9876543210';
const reload = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  const meta = document.createElement('meta');
  meta.name = 'agboard-build';
  meta.content = OWN;
  document.head.append(meta);
  vi.stubGlobal('location', { ...window.location, reload });
});

afterEach(() => {
  document.head.querySelector('meta[name="agboard-build"]')?.remove();
  vi.unstubAllGlobals();
  reload.mockReset();
});

describe('useBuildReload', () => {
  it('reloads when the server names another build', () => {
    renderHook(() => useBuildReload(NEW, false));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing before a ready event or on the same build', () => {
    renderHook(() => useBuildReload(null, false));
    renderHook(() => useBuildReload(OWN, false));
    expect(reload).not.toHaveBeenCalled();
  });

  it('waits while an edit or answer is open, then reloads', () => {
    const { rerender } = renderHook(({ busy }) => useBuildReload(NEW, busy), {
      initialProps: { busy: true },
    });
    expect(reload).not.toHaveBeenCalled();
    rerender({ busy: false });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  describe('with a presentation gate', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('waits while a drawer or a modal is open and for 3 seconds after it closes', () => {
      vi.useFakeTimers();
      const gate = new PresentationGate();
      const release = gate.acquire('drawer');
      renderHook(() => useBuildReload(NEW, false, gate));
      expect(reload).not.toHaveBeenCalled();

      release();
      vi.advanceTimersByTime(2_999);
      expect(reload).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does not wait when nothing is open', () => {
      renderHook(() => useBuildReload(NEW, false, new PresentationGate()));
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does not reload for work that began while it waited, and does after the work', () => {
      vi.useFakeTimers();
      const gate = new PresentationGate();
      const release = gate.acquire('drawer');
      const { rerender } = renderHook(({ busy }) => useBuildReload(NEW, busy, gate), {
        initialProps: { busy: false },
      });
      rerender({ busy: true });
      release();
      vi.advanceTimersByTime(3_000);
      expect(reload).not.toHaveBeenCalled();
      rerender({ busy: false });
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
