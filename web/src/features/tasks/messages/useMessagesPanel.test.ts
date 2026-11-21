import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMessagesPanel } from './useMessagesPanel';

describe('useMessagesPanel', () => {
  it('closes for a summary result and brings the Summary list back at its scroll position', () => {
    const { result } = renderHook(() => useMessagesPanel());
    act(() => result.current.open({ tab: 'summary' }));
    act(() => result.current.leaveForResult(480));
    expect(result.current.target).toBeNull();
    act(() => result.current.returnToList());
    expect(result.current.target).toEqual({ tab: 'summary', scrollTop: 480 });
  });

  it('brings the list back once', () => {
    const { result } = renderHook(() => useMessagesPanel());
    act(() => result.current.leaveForResult(10));
    act(() => result.current.returnToList());
    act(() => result.current.close());
    act(() => result.current.returnToList());
    expect(result.current.target).toBeNull();
  });

  it('does nothing when no result was opened from the list', () => {
    const { result } = renderHook(() => useMessagesPanel());
    act(() => result.current.returnToList());
    expect(result.current.target).toBeNull();
  });

  it('forgets the return when the list is opened or closed another way', () => {
    const { result } = renderHook(() => useMessagesPanel());
    act(() => result.current.leaveForResult(10));
    act(() => result.current.open({ tab: 'fromAi' }));
    act(() => result.current.close());
    act(() => result.current.returnToList());
    expect(result.current.target).toBeNull();
  });
});
