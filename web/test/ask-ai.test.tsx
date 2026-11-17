import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AskAiSheet } from '../src/features/messages/ask/AskAi';
import { AskAiDialog } from '../src/features/messages/ask/AskAiDialog';
import {
  buildRequestForm,
  sendMessageRequest,
  storedImageName,
} from '../src/features/messages/ask/sendRequest';
import { selectLocale } from '../src/shared/i18n';
import type { EditorAttachment } from '../src/shared/ui/editor/attachmentTypes';

const PROJECT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function local(id: string, name: string, type = 'image/png'): EditorAttachment {
  return {
    id,
    name,
    mediaType: type,
    size: 3,
    url: 'blob:x',
    source: 'local',
    file: new File(['abc'], name, { type }),
  };
}

beforeEach(() => {
  selectLocale('en');
  document.head.innerHTML = '<meta name="agboard-token" content="test-token">';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the stored name of a request image', () => {
  it('keeps a plain name and gives the type its extension', () => {
    expect(storedImageName({ name: 'login.png', mediaType: 'image/png' }, new Set())).toBe(
      'login.png',
    );
    expect(storedImageName({ name: 'photo', mediaType: 'image/jpeg' }, new Set())).toBe(
      'photo.jpg',
    );
    expect(storedImageName({ name: 'a.jpeg', mediaType: 'image/jpeg' }, new Set())).toBe('a.jpg');
  });

  it('turns characters the server refuses into underscores and keeps names unique', () => {
    expect(storedImageName({ name: '画面 1.png', mediaType: 'image/png' }, new Set())).toBe(
      '___1.png',
    );
    expect(storedImageName({ name: '.hidden.png', mediaType: 'image/png' }, new Set())).toBe(
      '_hidden.png',
    );
    expect(
      storedImageName({ name: 'image.png', mediaType: 'image/png' }, new Set(['image.png'])),
    ).toBe('image-2.png');
    expect(
      storedImageName({ name: `${'x'.repeat(200)}.png`, mediaType: 'image/png' }, new Set()),
    ).toMatch(/^x{80}\.png$/);
  });
});

describe('the request body', () => {
  it('rewrites image references to the stored names and sends one images part each', () => {
    const form = buildRequestForm(
      'See ![a](attachment:aaa) and ![b](attachment:bbb) ![c](attachment:zzz)',
      [local('aaa', 'image.png'), local('bbb', 'image.png')],
    );
    expect(form.get('text')).toBe(
      'See ![a](attachments/image.png) and ![b](attachments/image-2.png) ![c](attachment:zzz)',
    );
    const files = form.getAll('images') as File[];
    expect(files.map((file) => file.name)).toEqual(['image.png', 'image-2.png']);
  });

  it('posts to the messages endpoint with the token and raises the server reason', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json(
        { error: { code: 'invalid_value', message: 'invalid body.', reason: 'text is required.' } },
        { status: 422 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendMessageRequest(PROJECT, { text: 'x', attachments: [] })).rejects.toThrow(
      'text is required.',
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PROJECT}/messages/requests`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'X-Agboard-Token': 'test-token' });
    expect(init.body).toBeInstanceOf(FormData);
  });
});

describe('the Ask AI dialog', () => {
  it('requires the text and then hands it over trimmed', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AskAiDialog onClose={vi.fn()} onSubmit={onSubmit} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Enter your request.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByText(/epic/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /manually/i })).toBeNull();
  });

  it('keeps the sheet open and shows the reason when sending fails', async () => {
    const onClose = vi.fn();
    const onSavingChange = vi.fn();
    render(
      <AskAiDialog
        kind="sheet"
        initialText="Do this"
        onClose={onClose}
        onSavingChange={onSavingChange}
        onSubmit={vi.fn().mockRejectedValue(new Error('Request failed (503)'))}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send request' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Request failed (503)');
    expect(onClose).not.toHaveBeenCalled();
    expect(onSavingChange.mock.calls).toEqual([[true], [false]]);
  });
});

describe('the Ask AI sheet', () => {
  it('sends the request, reports it and closes', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ request: { id: 'Q-1' } }, { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    const onSent = vi.fn();
    render(
      <AskAiSheet
        projectId={PROJECT}
        initialText="Check the login page"
        onClose={onClose}
        onSent={onSent}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSent).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.body as FormData).get('text')).toBe('Check the login page');
  });
});
