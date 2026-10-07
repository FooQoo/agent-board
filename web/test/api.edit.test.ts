import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editCard, setDraft } from '../src/api';
import { fixtureCard } from './fixtures';

const PROJECT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return { path, init, headers: init.headers as Record<string, string> };
}

beforeEach(() => {
  document.head.innerHTML = '<meta name="skan-token" content="test-token">';
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
});

describe('editCard', () => {
  it('PATCHes the card with the token and the changed fields only', async () => {
    const card = { ...fixtureCard(8), isDraft: true };
    const fetchMock = respond(200, { card });
    const result = await editCard(PROJECT, 8, { description: '# New', finalize: true });
    const { path, init, headers } = lastCall(fetchMock);
    expect(path).toBe(`/api/projects/${PROJECT}/cards/8`);
    expect(init.method).toBe('PATCH');
    expect(headers['X-Skan-Token']).toBe('test-token');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ description: '# New', finalize: true });
    expect(result.card.id).toBe(8);
  });

  it('rejects with the reason of the error body', async () => {
    respond(409, {
      error: { code: 'card_not_draft', message: 'x', reason: 'The card is not a draft.' },
    });
    await expect(editCard(PROJECT, 8, { title: 'T' })).rejects.toThrow('The card is not a draft.');
  });
});

describe('setDraft', () => {
  it('PUTs the draft flag to the draft path with the token', async () => {
    const fetchMock = respond(200, { card: { ...fixtureCard(9), isDraft: true } });
    const result = await setDraft(PROJECT, 9, true);
    const { path, init, headers } = lastCall(fetchMock);
    expect(path).toBe(`/api/projects/${PROJECT}/cards/9/draft`);
    expect(init.method).toBe('PUT');
    expect(headers['X-Skan-Token']).toBe('test-token');
    expect(JSON.parse(init.body as string)).toEqual({ isDraft: true });
    expect(result.card.isDraft).toBe(true);
  });

  it('rejects when the card cannot become a draft', async () => {
    respond(409, {
      error: { code: 'invalid_state_for_draft', message: 'x', reason: 'The agent is working.' },
    });
    await expect(setDraft(PROJECT, 9, true)).rejects.toThrow('The agent is working.');
  });

  it('rejects with a status message when the body has no error', async () => {
    respond(500, {});
    await expect(setDraft(PROJECT, 9, false)).rejects.toThrow('Request failed (500)');
  });
});
