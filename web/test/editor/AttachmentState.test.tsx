import { act, renderHook, cleanup } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAttachmentState } from '../../src/components/editor/useAttachmentState';
import { useMultipartRequest } from '../../src/components/editor/useMultipartRequest';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('keeps previews alive under StrictMode and releases removed and unmounted files once', () => {
  const create = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValueOnce('blob:first')
    .mockReturnValueOnce('blob:second');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const { result, unmount } = renderHook(() => useAttachmentState({ resolveStoredUrl: () => '' }), {
    wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
  });
  act(() => result.current.addFiles([new File(['image'], 'screen.png', { type: 'image/png' })]));
  expect(result.current.attachments[0]?.id).toMatch(/^[0-9a-f]{32}$/);
  expect(create).toHaveBeenCalledTimes(1);
  expect(revoke).not.toHaveBeenCalled();
  const id = result.current.attachments[0]?.id;
  if (!id) throw new Error('Missing attachment');
  act(() => result.current.remove(id));
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:first');
  act(() => result.current.addFiles([new File(['image'], 'second.png', { type: 'image/png' })]));
  unmount();
  expect(revoke.mock.calls).toEqual([['blob:first'], ['blob:second']]);
});
it('rejects an invalid batch without creating previews', () => {
  const create = vi.spyOn(URL, 'createObjectURL');
  const { result } = renderHook(() => useAttachmentState({ resolveStoredUrl: () => '' }));
  act(() =>
    result.current.addFiles([
      new File(['x'], 'image.png', { type: 'image/png' }),
      new File(['x'], 'file.txt', { type: 'text/plain' }),
    ]),
  );
  expect(result.current.attachments).toHaveLength(0);
  expect(result.current.error).not.toBeNull();
  expect(create).not.toHaveBeenCalled();
});
it('reuses the same write ID on retry and changes it when input changes', () => {
  const { result, rerender } = renderHook(useMultipartRequest);
  const first = result.current({ title: 'card', ids: ['a'] });
  rerender();
  expect(result.current({ title: 'card', ids: ['a'] })).toBe(first);
  expect(result.current({ title: 'changed', ids: ['a'] })).not.toBe(first);
});
