import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EpicApi } from '../../src/features/epics/editor/epicApi';
import { useEpicEditor } from '../../src/features/epics/editor/useEpicEditor';
import type { Epic } from '../../src/shared/api/contracts';
import { makeTask } from '../fixtures';

vi.mock(
  '../../src/shared/rich-editor/RichMarkdownEditor',
  () => import('../editor/fakeRichEditor'),
);

const IMAGE = 'c'.repeat(32);
const ref = { id: 'FILE-SHARE', name: 'File share', color: '#7C3AED' };
const EPIC: Epic = {
  id: 'FILE-SHARE',
  name: 'File share',
  color: '#7C3AED',
  isDraft: false,
  document: '## Goal\n\nShare.',
  body: '## Goal\n\nShare.',
  priority: [],
  priorityError: false,
  attachments: [
    {
      id: IMAGE,
      name: 'shot.png',
      mediaType: 'image/png',
      size: 10,
      createdAt: '2026-10-02T00:00:00Z',
    },
  ],
  createdAt: '2026-10-02T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
};
const TASKS = [
  makeTask({ id: 24, title: 'First', epic: ref }),
  makeTask({ id: 25, title: 'Second', epic: ref }),
];

function fakeApi(calls: string[]): EpicApi {
  return {
    addImages: vi.fn(async () => void calls.push('addImages')),
    removeImage: vi.fn(async () => void calls.push('removeImage')),
    save: vi.fn(async () => void calls.push('save')),
    savePriority: vi.fn(async (ids: number[]) => void calls.push(`savePriority:${ids.join(',')}`)),
    enterDraft: vi.fn(async () => {
      calls.push('enterDraft');
      return { ...EPIC, isDraft: true };
    }),
    leaveDraft: vi.fn(async () => void calls.push('leaveDraft')),
    remove: vi.fn(async () => void calls.push('remove')),
  };
}

function mount(api: EpicApi, onClose = vi.fn()) {
  return renderHook(() =>
    useEpicEditor({
      epic: EPIC,
      tasks: TASKS,
      api,
      projectId: 'p',
      onOpenTask: vi.fn(),
      onClose,
    }),
  );
}

describe('useEpicEditor save order', () => {
  it('saves the images, then the order, then the epic in the last request', async () => {
    const calls: string[] = [];
    const api = fakeApi(calls);
    const onClose = vi.fn();
    const { result } = mount(api, onClose);
    act(() => result.current.removeAttachment(IMAGE));
    act(() => result.current.move(0, 1));
    act(() => result.current.setName('Renamed'));
    await waitFor(() => expect(result.current.canSave).toBe(true));
    await act(async () => result.current.run());
    expect(calls).toEqual(['enterDraft', 'removeImage', 'savePriority:25,24', 'save']);
    expect(api.save).toHaveBeenCalledWith({
      name: 'Renamed',
      color: '#7C3AED',
      body: '## Goal\n\nShare.',
      isDraft: false,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not write the order again on a retry after the last request failed', async () => {
    const calls: string[] = [];
    const api = fakeApi(calls);
    api.save = vi
      .fn<EpicApi['save']>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(async () => void calls.push('save'));
    const { result } = mount(api);
    act(() => result.current.move(0, 1));
    await waitFor(() => expect(result.current.canSave).toBe(true));
    await act(async () => result.current.run());
    expect(result.current.error).toContain('Earlier changes were saved');
    await act(async () => result.current.run());
    expect(calls).toEqual(['enterDraft', 'savePriority:25,24', 'save']);
  });

  it('finalizes with the last request alone when only the order changed', async () => {
    const calls: string[] = [];
    const api = fakeApi(calls);
    const { result } = mount(api);
    act(() => result.current.move(0, 1));
    await waitFor(() => expect(result.current.canSave).toBe(true));
    await act(async () => result.current.run());
    expect(calls).toEqual(['enterDraft', 'savePriority:25,24', 'save']);
  });
});
