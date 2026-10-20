import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addEpicAttachments,
  deleteEpicAttachment,
  setTaskEpic,
  updateEpic,
  WriteError,
} from '../src/app/api';
import { epicApi } from '../src/features/epics/editor/epicApi';
import type { EditorAttachment } from '../src/shared/ui/editor/attachmentTypes';

const PROJECT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const EPIC = { id: 'FILE-SHARE', name: 'File share', color: '#7C3AED', isDraft: false };

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('epic writes', () => {
  it('patches only the given fields of the epic', async () => {
    const fetchMock = stubFetch(200, { epic: EPIC, changed: true });
    const result = await updateEpic(PROJECT, 'FILE-SHARE', { document: '## Goal' });
    expect(result.epic).toEqual(EPIC);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/projects/${PROJECT}/epics/FILE-SHARE`);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ document: '## Goal' });
  });

  it('saves the whole epic document as document, and its body as body', async () => {
    const fetchMock = stubFetch(200, { epic: EPIC, changed: true });
    const api = epicApi(PROJECT, 'FILE-SHARE', () => {});
    await api.saveDocument({ document: '---\npriority: [1]\n---\n## Goal' });
    await api.saveDocument({ body: '## Goal' });
    const [first, second] = fetchMock.mock.calls;
    expect(JSON.parse(String(first?.[1]?.body))).toEqual({
      document: '---\npriority: [1]\n---\n## Goal',
    });
    expect(JSON.parse(String(second?.[1]?.body))).toEqual({ body: '## Goal' });
  });

  it('puts a task into an epic and takes it out with null', async () => {
    const fetchMock = stubFetch(200, { task: { id: 27 } });
    await setTaskEpic(PROJECT, 27, 'FILE-SHARE');
    await setTaskEpic(PROJECT, 27, null);
    const [first, second] = fetchMock.mock.calls;
    expect(first?.[0]).toBe(`/api/projects/${PROJECT}/tasks/27/epic`);
    expect(first?.[1]?.method).toBe('PUT');
    expect(JSON.parse(String(first?.[1]?.body))).toEqual({ epicId: 'FILE-SHARE' });
    expect(JSON.parse(String(second?.[1]?.body))).toEqual({ epicId: null });
  });

  it('sends the new images as a multipart write with the IDs the screen made', async () => {
    const fetchMock = stubFetch(201, { epic: EPIC });
    const file = new File(['png'], 'shot.png', { type: 'image/png' });
    const attachment: EditorAttachment = {
      id: 'a'.repeat(32),
      name: 'shot.png',
      mediaType: 'image/png',
      size: 3,
      url: 'blob:x',
      source: 'local',
      file,
    };
    await addEpicAttachments(PROJECT, 'FILE-SHARE', [attachment], 'req-1');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/projects/${PROJECT}/epics/FILE-SHARE/attachments`);
    expect(init?.method).toBe('POST');
    const form = init?.body as FormData;
    expect(JSON.parse(String(form.get('metadata')))).toEqual({
      requestId: 'req-1',
      attachments: [{ id: 'a'.repeat(32), name: 'shot.png' }],
    });
    expect(form.get('file')).toBeInstanceOf(File);
  });

  it('deletes one image of an epic', async () => {
    const fetchMock = stubFetch(200, { epic: EPIC });
    await deleteEpicAttachment(PROJECT, 'FILE-SHARE', 'b'.repeat(32));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/projects/${PROJECT}/epics/FILE-SHARE/attachments/${'b'.repeat(32)}`);
    expect(init?.method).toBe('DELETE');
  });

  it('turns a refused write into a WriteError with the server reason', async () => {
    stubFetch(409, {
      error: { code: 'task_archived', message: 'x', reason: 'Task #8 is archived.' },
    });
    const failure = await setTaskEpic(PROJECT, 8, 'FILE-SHARE').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WriteError);
    expect((failure as WriteError).message).toBe('Task #8 is archived.');
    expect((failure as WriteError).code).toBe('task_archived');
  });
});
