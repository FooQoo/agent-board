import { act, renderHook, cleanup } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAttachmentState } from '../../src/shared/ui/editor/useAttachmentState';
import { useMultipartRequest } from '../../src/shared/ui/editor/useMultipartRequest';

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
it('names the file that is too large, and reports the count and the total as limits', () => {
  const { result } = renderHook(() => useAttachmentState({ resolveStoredUrl: () => '' }));
  const large = new File(['x'], 'large.png', { type: 'image/png' });
  Object.defineProperty(large, 'size', { value: 11 * 1024 * 1024 });
  act(() => result.current.addFiles([large]));
  expect(result.current.error).toEqual({ kind: 'tooLarge', name: 'large.png' });
  expect(result.current.attachments).toHaveLength(0);

  act(() =>
    result.current.addFiles(
      Array.from(
        { length: 21 },
        (_, index) => new File(['x'], `${index}.png`, { type: 'image/png' }),
      ),
    ),
  );
  expect(result.current.error).toEqual({ kind: 'count' });

  const sized = Array.from({ length: 6 }, (_, index) => {
    const file = new File(['x'], `${index}.gif`, { type: 'image/gif' });
    Object.defineProperty(file, 'size', { value: 9 * 1024 * 1024 });
    return file;
  });
  act(() => result.current.addFiles(sized));
  expect(result.current.error).toEqual({ kind: 'total' });
});

it('names the file of a wrong format and clears the notice on the next valid pick', () => {
  const { result } = renderHook(() => useAttachmentState({ resolveStoredUrl: () => '' }));
  act(() => result.current.addFiles([new File(['x'], 'notes.txt', { type: 'text/plain' })]));
  expect(result.current.error).toEqual({ kind: 'format', name: 'notes.txt' });
  act(() => result.current.addFiles([new File(['x'], 'ok.png', { type: 'image/png' })]));
  expect(result.current.error).toBeNull();
  expect(result.current.attachments).toHaveLength(1);
});
