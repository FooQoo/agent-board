import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WriteError, createNewCard } from '../src/api';
import type { EditorAttachment } from '../src/components/editor/attachmentTypes';
import { fixtureCard } from './fixtures';

const PROJECT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  document.head.innerHTML = '<meta name="agboard-token" content="test-token">';
});

afterEach(() => vi.unstubAllGlobals());

describe('creating a card', () => {
  it('sends the draft flag in the one create request', async () => {
    const fetchMock = respond(201, { card: { ...fixtureCard(9), isDraft: true } });
    const result = await createNewCard(PROJECT, {
      title: 'New work',
      description: '',
      assignee: 'ai',
      isDraft: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PROJECT}/cards`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'New work',
      description: '',
      assignee: 'ai',
      isDraft: true,
    });
    expect(result.card.isDraft).toBe(true);
  });

  it('sends false when the draft box is clear, and a normal card is made', async () => {
    const fetchMock = respond(201, { card: fixtureCard(9) });
    await createNewCard(PROJECT, { title: 'Plain', description: '', assignee: 'human' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Plain',
      description: '',
      assignee: 'human',
      isDraft: false,
    });
  });

  it('sends the draft flag in the multipart metadata with the images, in one request', async () => {
    const fetchMock = respond(201, { card: { ...fixtureCard(9), isDraft: true } });
    const file = new File(['png'], 'shot.png', { type: 'image/png' });
    const attachment: EditorAttachment = {
      id: '0123456789abcdef0123456789abcdef',
      name: 'shot.png',
      mediaType: 'image/png',
      size: 3,
      url: 'blob:x',
      source: 'local',
      file,
    };
    await createNewCard(PROJECT, {
      title: 'With image',
      description: '',
      assignee: 'ai',
      isDraft: true,
      requestId: 'req-1',
      attachments: [attachment],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PROJECT}/cards/multipart`);
    const form = init.body as FormData;
    const metadata = JSON.parse(String(form.get('metadata')));
    expect(metadata).toMatchObject({ requestId: 'req-1', isDraft: true, title: 'With image' });
    expect(form.get('file')).toBeInstanceOf(File);
  });

  it('makes no second request when the create is refused', async () => {
    const fetchMock = respond(422, {
      error: { code: 'invalid_value', message: 'x', reason: 'Title is too long.' },
    });
    const failure = await createNewCard(PROJECT, {
      title: 'x',
      description: '',
      assignee: 'ai',
      isDraft: true,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WriteError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
