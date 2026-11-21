import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeMonitorTask, makeProject, makeTask } from '../../../../.storybook/support/fixtures';
import type { Lanes } from '../model/overlay';
import { useLaneOverlay } from './useLaneOverlay';

const project = makeProject({});
const lanes = (name: keyof Lanes): Lanes => ({
  backlog: [],
  todo: [],
  doing: [],
  done: [],
  [name]: [makeMonitorTask(makeTask({ id: 1, taskStatus: name }), project)],
});
const where = (shown: Lanes) =>
  (['todo', 'doing', 'done'] as const).find((name) => shown[name].length > 0);

describe('useLaneOverlay', () => {
  it('holds the target until the save is accepted, then yields to a newer read', () => {
    const old = lanes('todo');
    const { result, rerender } = renderHook(({ read }) => useLaneOverlay(read), {
      initialProps: { read: old },
    });
    act(() => result.current.move(1, 'doing'));
    rerender({ read: lanes('todo') });
    expect(where(result.current.lanes)).toBe('doing');
    act(() => result.current.settle(1));
    rerender({ read: lanes('done') });
    expect(where(result.current.lanes)).toBe('done');
  });

  it('takes a refused move back', () => {
    const { result } = renderHook(() => useLaneOverlay(lanes('todo')));
    act(() => result.current.move(1, 'doing'));
    act(() => result.current.unmove(1));
    expect(where(result.current.lanes)).toBe('todo');
  });
});
