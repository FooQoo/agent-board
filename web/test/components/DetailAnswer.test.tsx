import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailPanel } from '../../src/components/DetailPanel';
import { selectLocale } from '../../src/i18n';
import type { OperationControls } from '../../src/lib/projectSession';
import type { Card } from '../../src/types';
import { deferred, jsonResponse } from '../fakes';
import { PROJECT_A, fixtureCard } from '../fixtures';

const noop = () => {};
const noRemove = async () => true;
const LONG =
  'It is unclear whether to keep the existing data or start from scratch. There are three options: replace the old board, export it and import a new one, or keep both for now. Please decide which one to use.';

function operationsSpy(): OperationControls & { begin: ReturnType<typeof vi.fn> } {
  let next = 0;
  return {
    begin: vi.fn(() => ++next),
    saveStarted: vi.fn(),
    saveFailed: vi.fn(),
    end: vi.fn(),
    cardRemoved: vi.fn(),
  };
}

function renderPanel(
  card: Card = fixtureCard(12),
  extra: { operations?: OperationControls; onChanged?: () => void } = {},
) {
  const onChanged = extra.onChanged ?? vi.fn();
  const utils = render(
    <DetailPanel
      projectId={PROJECT_A.id}
      card={card}
      operations={extra.operations}
      onClose={noop}
      onRemove={noRemove}
      onChanged={onChanged}
    />,
  );
  return { ...utils, onChanged };
}

const open = () => userEvent.click(screen.getByRole('button', { name: 'Answer' }));
const box = () => screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement;
const send = () => screen.getByRole('button', { name: /^(Send|Retry)$/ }) as HTMLButtonElement;

beforeEach(() => {
  selectLocale('en');
  document.head.innerHTML = '<meta name="skan-token" content="test-token">';
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
  selectLocale('en');
});

describe('decision request', () => {
  it('is shown above the tabs for a pending card, with the reason and Answer', () => {
    const { container } = renderPanel();
    const request = container.querySelector('.detail__request') as HTMLElement;
    expect(request.textContent).toContain('The agent is waiting for your answer');
    expect(request.textContent).toContain('Waiting for confirmation on how to replace a board.');
    expect(within(request).getByRole('button', { name: 'Answer' })).toBeTruthy();
    const tabs = container.querySelector('.detail__tabs') as HTMLElement;
    expect(request.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is not shown for cards that are not pending', () => {
    renderPanel(fixtureCard(11));
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    expect(screen.queryByText('The agent is waiting for your answer')).toBeNull();
  });

  it('is written in Japanese', () => {
    selectLocale('ja');
    renderPanel();
    expect(screen.getByText('AIが回答を待っています')).toBeTruthy();
    expect(screen.getByRole('button', { name: '回答する' })).toBeTruthy();
  });

  it('opens a labelled text area in place, not a dialog, and keeps the tabs readable', async () => {
    renderPanel({ ...fixtureCard(12), description: 'Body text' });
    await open();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(box());
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    expect(screen.getByText('Body text')).toBeTruthy();
    await userEvent.type(box(), 'Start fresh');
    await userEvent.click(screen.getByRole('tab', { name: /^History/ }));
    expect(box().value).toBe('Start fresh');
    await userEvent.click(screen.getByRole('tab', { name: 'Description' }));
    expect(screen.getByText('Body text')).toBeTruthy();
  });

  it('cancels back to the Answer button and drops the input', async () => {
    renderPanel();
    await open();
    await userEvent.type(box(), 'draft answer');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    await open();
    expect(box().value).toBe('');
  });

  it('cuts a long reason at four lines and shows all of it with Show more', async () => {
    const lineBox = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(200);
    const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(78);
    try {
      const { container } = renderPanel({ ...fixtureCard(12), pendingReason: LONG });
      const reason = container.querySelector('.detail__reason') as HTMLElement;
      expect(reason.className).toContain('detail__reason--clamped');
      await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
      expect(reason.className).not.toContain('detail__reason--clamped');
      expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    } finally {
      lineBox.mockRestore();
      client.mockRestore();
    }
  });

  it('has no Show more for a short reason', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});

describe('sending the answer', () => {
  it('keeps Send off while the input is empty or blank and says why', async () => {
    renderPanel();
    await open();
    expect(send().disabled).toBe(true);
    expect(screen.getByText('Enter your answer.')).toBeTruthy();
    await userEvent.type(box(), '   ');
    expect(send().disabled).toBe(true);
    await userEvent.type(box(), 'x');
    expect(send().disabled).toBe(false);
    expect(screen.queryByText('Enter your answer.')).toBeNull();
  });

  it('sends the answer with the request id, reports the change and closes the form', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ card: fixtureCard(12), changed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const card = fixtureCard(12);
    const { onChanged } = renderPanel(card);
    await open();
    await userEvent.type(box(), 'Start fresh');
    await userEvent.click(send());
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PROJECT_A.id}/cards/12/answer`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      requestId: card.pendingRequestId,
      reason: 'Start fresh',
    });
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows the sending state, refuses a second send and Cancel, and keeps the project from changing', async () => {
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => gate.promise),
    );
    const operations = operationsSpy();
    renderPanel(fixtureCard(12), { operations });
    await open();
    expect(operations.begin).toHaveBeenCalledWith('answer', PROJECT_A.id);
    await userEvent.type(box(), 'Go');
    await userEvent.click(send());
    expect(operations.saveStarted).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Sending…' })).toHaveProperty('disabled', true);
    expect(box().disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
    expect(box().value).toBe('Go');
    gate.resolve(jsonResponse({ card: fixtureCard(12), changed: true }));
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(operations.end).toHaveBeenCalled();
  });

  it('shows an error, keeps the input and offers Retry when saving fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'database_busy', message: 'x', reason: 'busy' } }, 503),
      )
      .mockResolvedValueOnce(jsonResponse({ card: fixtureCard(12), changed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const operations = operationsSpy();
    const { onChanged } = renderPanel(fixtureCard(12), { operations });
    await open();
    await userEvent.type(box(), 'Keep me');
    await userEvent.click(send());
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save. Try again.');
    expect(box().value).toBe('Keep me');
    expect(box().getAttribute('aria-invalid')).toBe('true');
    expect(operations.saveFailed).toHaveBeenCalledTimes(1);
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveProperty('disabled', false);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('says the request changed on request_changed, keeps the input and reloads the board', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: 'request_changed',
              message: 'x',
              reason: 'the pending request has changed.',
            },
          },
          409,
        ),
      ),
    );
    const { onChanged } = renderPanel();
    await open();
    await userEvent.type(box(), 'Old answer');
    await userEvent.click(send());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This request has changed. Review the latest board.',
    );
    expect(box().value).toBe('Old answer');
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(send().disabled).toBe(true);
    await userEvent.type(box(), '!');
    expect(send().disabled).toBe(false);
  });

  it('notices a changed request while the form is open and sends the new id after an edit', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ card: fixtureCard(12), changed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const first = fixtureCard(12);
    const { rerender } = renderPanel(first);
    await open();
    await userEvent.type(box(), 'Answer');
    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={{ ...first, pendingRequestId: 'new-request', pendingReason: 'A new question' }}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    expect(screen.getByText('A new question')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      'This request has changed. Review the latest board.',
    );
    expect(box().value).toBe('Answer');
    expect(send().disabled).toBe(true);
    await userEvent.type(box(), '.');
    await userEvent.click(send());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ requestId: 'new-request', reason: 'Answer.' });
  });

  it('registers the open form as an operation and ends it on cancel', async () => {
    const operations = operationsSpy();
    renderPanel(fixtureCard(12), { operations });
    expect(operations.begin).not.toHaveBeenCalled();
    await open();
    expect(operations.begin).toHaveBeenCalledWith('answer', PROJECT_A.id);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(operations.end).toHaveBeenCalledWith(1);
  });

  it('closes the form with the panel when another card is shown', async () => {
    const operations = operationsSpy();
    const { rerender } = renderPanel(fixtureCard(12), { operations });
    await open();
    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(8)}
        operations={operations}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(operations.end).toHaveBeenCalledWith(1);
  });

  it('labels and hints in Japanese', async () => {
    selectLocale('ja');
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: '回答する' }));
    expect(screen.getByRole('textbox', { name: '回答' })).toBeTruthy();
    expect(screen.getByText('回答を入力してください。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '送信' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy();
  });
});
