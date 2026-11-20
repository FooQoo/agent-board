import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectId } from '@/shared/api/contracts';
import type { EditorAttachment } from '@/shared/ui/editor/attachmentTypes';
import { answerMessages } from './api';

const project = 'a'.repeat(32) as ProjectId;

function local(name: string): EditorAttachment {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
  return {
    id: name,
    name,
    mediaType: 'image/png',
    size: 3,
    url: 'blob:x',
    source: 'local',
    file,
  };
}

function respondWith(body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('answerMessages', () => {
  it('sends a plain JSON answer when there is no image', async () => {
    const fetchMock = respondWith({ questions: [] });
    await answerMessages(project, [{ questionId: 'Q-1', text: 'ok' }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith('/messages/answers')).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({
      answers: [{ questionId: 'Q-1', text: 'ok' }],
    });
  });

  it('sends the images as images.<questionId> parts with plain stored names', async () => {
    const fetchMock = respondWith({ questions: [] });
    await answerMessages(
      project,
      [{ questionId: 'Q-7', choiceId: 'keep' }],
      [local('Screen Shot.png'), local('Screen Shot.png')],
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith('/messages/answers/multipart')).toBe(true);
    const form = init.body as FormData;
    expect(JSON.parse(form.get('metadata') as string)).toEqual({
      answers: [{ questionId: 'Q-7', choiceId: 'keep' }],
    });
    const parts = form.getAll('images.Q-7') as File[];
    expect(parts.map((part) => part.name)).toEqual(['Screen_Shot.png', 'Screen_Shot-2.png']);
  });
});
