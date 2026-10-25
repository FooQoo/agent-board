import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WriteError } from '../../api/writeErrors';
import '../../i18n';
import { useSaveFlow } from './useSaveFlow';

describe('useSaveFlow', () => {
  it('closes after a successful save by default', async () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSaveFlow({ onClose }));
    await act(() => result.current.run(async () => {}));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open after a successful save with closeOnSuccess: false', async () => {
    const onClose = vi.fn();
    const save = vi.fn(async () => {});
    const { result } = renderHook(() => useSaveFlow({ onClose, closeOnSuccess: false }));
    await act(() => result.current.run(save));
    expect(save).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
    expect(result.current.busy.current).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('keeps the input and reports an error when the save fails', async () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSaveFlow({ onClose, closeOnSuccess: false }));
    await act(() =>
      result.current.run(async () => {
        throw new WriteError('boom', 500, null);
      }),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(result.current.error).not.toBeNull();
  });

  it('refuses a second save while one is running', async () => {
    const onClose = vi.fn();
    let release: () => void = () => {};
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useSaveFlow({ onClose, closeOnSuccess: false }));
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.run(save);
    });
    await act(() => result.current.run(save));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await first;
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
