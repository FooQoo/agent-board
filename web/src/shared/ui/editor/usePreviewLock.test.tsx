import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WriteError } from '../../api/writeErrors';
import { usePreviewLock } from './usePreviewLock';

interface Input {
  draftAtOpen: boolean;
  readOnly: boolean;
  dirty: boolean;
  snapshot: string;
}

const clean: Input = { draftAtOpen: false, readOnly: false, dirty: false, snapshot: 'a' };
const edited: Input = { ...clean, dirty: true, snapshot: 'a+' };

function setup(
  enter: () => Promise<string> = async () => 'a',
  leave: () => Promise<void> = async () => {},
) {
  const enterFn = vi.fn(enter);
  const leaveFn = vi.fn(leave);
  const hook = renderHook(
    (input: Input) => usePreviewLock({ ...input, enter: enterFn, leave: leaveFn }),
    { initialProps: clean },
  );
  return { ...hook, enterFn, leaveFn };
}

const running = () => new WriteError('running', 409, 'invalid_state_for_draft');

describe('usePreviewLock', () => {
  it('reads without entering and cannot save while there is no change', () => {
    const { result, enterFn } = setup();
    expect(result.current).toMatchObject({ entered: false, problem: null, canSave: false });
    expect(enterFn).not.toHaveBeenCalled();
  });

  it('enters a draft at the first change and allows saving once locked', async () => {
    const { result, rerender, enterFn } = setup();
    await act(async () => rerender(edited));
    expect(enterFn).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ entered: true, problem: null, canSave: true });
  });

  it('does not allow saving while the draft is being entered', async () => {
    let resolve: (value: string) => void = () => {};
    const { result, rerender } = setup(() => new Promise((r) => (resolve = r)));
    act(() => rerender(edited));
    expect(result.current.canSave).toBe(false);
    await act(async () => resolve('a'));
    expect(result.current.canSave).toBe(true);
  });

  it('does not call enter twice for continued typing or while one is running', async () => {
    let resolve: (value: string) => void = () => {};
    const { result, rerender, enterFn } = setup(() => new Promise((r) => (resolve = r)));
    act(() => rerender(edited));
    act(() => rerender({ ...edited, snapshot: 'a++' }));
    expect(enterFn).toHaveBeenCalledTimes(1);
    await act(async () => resolve('a'));
    await act(async () => rerender({ ...edited, snapshot: 'a+++' }));
    expect(enterFn).toHaveBeenCalledTimes(1);
    expect(result.current.entered).toBe(true);
  });

  it('does not enter when the draft was open already, and still allows saving', async () => {
    const { result, rerender, enterFn } = setup();
    await act(async () => rerender({ ...clean, draftAtOpen: true }));
    await act(async () => rerender({ ...edited, draftAtOpen: true }));
    expect(enterFn).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ entered: false, problem: null, canSave: true });
  });

  it('does not enter and cannot save in a read-only modal', async () => {
    const { result, rerender, enterFn } = setup();
    await act(async () => rerender({ ...edited, readOnly: true }));
    expect(enterFn).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ entered: false, problem: null, canSave: false });
  });

  it('reports running when the draft is refused, keeps the input, and enters again at the next input', async () => {
    const enter = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(running())
      .mockResolvedValue('a');
    const { result, rerender, enterFn } = setup(enter);
    await act(async () => rerender(edited));
    expect(result.current).toMatchObject({ entered: false, problem: 'running', canSave: false });
    await act(async () => rerender({ ...edited, snapshot: 'a++' }));
    expect(enterFn).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ entered: true, problem: null, canSave: true });
  });

  it('enters again when the run stops and the modal stops being read-only', async () => {
    const enter = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(running())
      .mockResolvedValue('a');
    const { result, rerender } = setup(enter);
    await act(async () => rerender(edited));
    await act(async () => rerender({ ...edited, readOnly: true }));
    expect(enter).toHaveBeenCalledTimes(1);
    await act(async () => rerender({ ...edited, readOnly: false }));
    expect(enter).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ entered: true, problem: null });
  });

  it('reports failed for any other failure and enters again at the next input', async () => {
    const enter = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new WriteError('boom', 500, 'internal'))
      .mockResolvedValue('a');
    const { result, rerender } = setup(enter);
    await act(async () => rerender(edited));
    expect(result.current).toMatchObject({ entered: false, problem: 'failed', canSave: false });
    await act(async () => rerender({ ...edited, snapshot: 'a++' }));
    expect(result.current.problem).toBe('failed');
    await act(async () => rerender({ ...edited, snapshot: 'a+++' }));
    expect(enter).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ entered: true, problem: null, canSave: true });
  });

  it('does not retry on its own after a failure', async () => {
    const { rerender, enterFn } = setup(async () => {
      throw new Error('network');
    });
    await act(async () => rerender(edited));
    await act(async () => rerender(edited));
    expect(enterFn).toHaveBeenCalledTimes(1);
  });

  it('reports a conflict when the draft holds other content than the modal had, and cannot save', async () => {
    const { result, rerender, leaveFn } = setup(async () => 'b');
    await act(async () => rerender(edited));
    expect(result.current).toMatchObject({ entered: true, problem: 'conflict', canSave: false });
    await act(async () => rerender({ ...edited, snapshot: 'a++' }));
    expect(result.current.problem).toBe('conflict');
    await act(async () => result.current.release());
    expect(leaveFn).toHaveBeenCalledTimes(1);
  });

  it('compares the content the modal showed before the change, not the edited content', async () => {
    const { result, rerender } = setup(async () => 'a');
    await act(async () => rerender({ ...clean, snapshot: 'x' }));
    await act(async () => rerender({ ...edited, snapshot: 'x+' }));
    expect(result.current.problem).toBe('conflict');
  });

  it('clears a problem when the changes are taken back', async () => {
    const { result, rerender } = setup(async () => {
      throw running();
    });
    await act(async () => rerender(edited));
    expect(result.current.problem).toBe('running');
    await act(async () => rerender(clean));
    expect(result.current.problem).toBeNull();
  });

  it('leaves the draft on release only when it was entered', async () => {
    const { result, rerender, leaveFn } = setup();
    await act(async () => result.current.release());
    expect(leaveFn).not.toHaveBeenCalled();
    await act(async () => rerender(edited));
    await act(async () => result.current.release());
    expect(leaveFn).toHaveBeenCalledTimes(1);
    expect(result.current.entered).toBe(false);
    await act(async () => result.current.release());
    expect(leaveFn).toHaveBeenCalledTimes(1);
  });

  it('does not leave a draft that was open already', async () => {
    const { result, rerender, leaveFn } = setup();
    await act(async () => rerender({ ...edited, draftAtOpen: true }));
    await act(async () => result.current.release());
    expect(leaveFn).not.toHaveBeenCalled();
  });

  it('waits for an enter in flight before deciding to leave', async () => {
    let resolve: (value: string) => void = () => {};
    const { result, rerender, leaveFn } = setup(() => new Promise((r) => (resolve = r)));
    act(() => rerender(edited));
    let released: Promise<void> = Promise.resolve();
    act(() => {
      released = result.current.release();
    });
    await act(async () => {
      resolve('a');
      await released;
    });
    expect(leaveFn).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft entered when the leave fails', async () => {
    const { result, rerender } = setup(undefined, async () => {
      throw new Error('network');
    });
    await act(async () => rerender(edited));
    await act(async () => {
      await result.current.release().catch(() => {});
    });
    expect(result.current.entered).toBe(true);
  });
});
