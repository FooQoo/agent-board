import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBuildReload } from '../../src/hooks/useBuildReload';

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
});
