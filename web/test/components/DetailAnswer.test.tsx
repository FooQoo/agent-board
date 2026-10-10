import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailPanel } from '../../src/components/DetailPanel';
import { selectLocale } from '../../src/i18n';
import type { OperationControls } from '../../src/lib/projectSession';
import type { Card } from '../../src/types';
import { deferred, jsonResponse } from '../fakes';
import { PROJECT_A, makeCard } from '../fixtures';

const noop = () => {};
const noRemove = async () => true;
const LONG =
  'It is unclear whether to keep the existing data or start from scratch. There are three options: replace the old board, export it and import a new one, or keep both for now. Please decide which one to use.';

const pendingCard = (overrides: Partial<Card> = {}): Card =>
  makeCard({
    id: 12,
    title: 'Pending card',
    cardStatus: 'doing',
    agentStatus: 'pending',
    pendingRequestId: 'req-1',
    pendingReason: 'Which way should the board go?',
    pendingChoices: [
      { id: 'keep', label: 'Keep the data' },
      { id: 'reset', label: 'Start over' },
    ],
    ...overrides,
  });

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

function renderPanel(card: Card = pendingCard(), extra: { operations?: OperationControls } = {}) {
  const onChanged = vi.fn();
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

const request = (container: HTMLElement) =>
  container.querySelector('.detail__request') as HTMLElement;
const box = () => screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement;
const send = () => screen.getByRole('button', { name: /^(Send|Retry)$/ }) as HTMLButtonElement;
const choice = (label: string) => screen.getByRole('radio', { name: label });
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

beforeEach(() => {
  selectLocale('en');
  document.head.innerHTML = '<meta name="skan-token" content="test-token">';
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
  selectLocale('en');
});

describe('answer form', () => {
  it('is shown open above the tabs: question, choices, text, then Send', () => {
    const { container } = renderPanel();
    const section = request(container);
    expect(within(section).getByText('Which way should the board go?')).toBeTruthy();
    expect(within(section).getAllByRole('radio')).toHaveLength(2);
    expect(box().value).toBe('');
    expect(choice('Keep the data').getAttribute('aria-checked')).toBe('false');
    expect(send().disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    const tabs = container.querySelector('.detail__tabs') as HTMLElement;
    expect(section.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const order = [
      ...section.querySelectorAll('[role="radiogroup"], textarea, button[type="submit"]'),
    ];
    expect(order.map((el) => el.tagName)).toEqual(['DIV', 'TEXTAREA', 'BUTTON']);
  });

  it('shows only the text box when the request has no choices', () => {
    renderPanel(pendingCard({ pendingChoices: [] }));
    expect(screen.queryByRole('radio')).toBeNull();
    expect(box()).toBeTruthy();
    expect(send().disabled).toBe(true);
  });

  it('enables Send with a choice, with a text, or with both, and never for blank text', async () => {
    renderPanel();
    await userEvent.type(box(), '   ');
    expect(send().disabled).toBe(true);
    await userEvent.click(choice('Start over'));
    expect(send().disabled).toBe(false);
    await userEvent.clear(box());
    await userEvent.type(box(), 'Because');
    expect(send().disabled).toBe(false);
  });

  it('sends the chosen option only, the text only, or both with the request id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ card: pendingCard(), changed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const first = renderPanel();
    await userEvent.click(choice('Start over'));
    await userEvent.click(send());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      `/api/projects/${PROJECT_A.id}/cards/12/answer`,
    );
    expect(bodyOf(fetchMock.mock.calls[0] as unknown[])).toEqual({
      requestId: 'req-1',
      choiceId: 'reset',
    });
    first.unmount();

    renderPanel();
    await userEvent.type(box(), 'Only words');
    await userEvent.click(send());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodyOf(fetchMock.mock.calls[1] as unknown[])).toEqual({
      requestId: 'req-1',
      text: 'Only words',
    });
  });

  it('refuses a second send while the first is in flight and keeps the input', async () => {
    const gate = deferred<Response>();
    const fetchMock = vi.fn(() => gate.promise);
    vi.stubGlobal('fetch', fetchMock);
    const operations = operationsSpy();
    renderPanel(pendingCard(), { operations });
    await userEvent.type(box(), 'Go');
    await userEvent.click(send());
    expect(screen.getByRole('button', { name: 'Sending…' })).toHaveProperty('disabled', true);
    expect(box().disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Sending…' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    gate.resolve(jsonResponse({ card: pendingCard(), changed: true }));
    await waitFor(() => expect(operations.end).toHaveBeenCalled());
  });

  it('keeps the input and shows an error when saving fails, then retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'database_busy', message: 'x', reason: 'busy' } }, 503),
      )
      .mockResolvedValueOnce(jsonResponse({ card: pendingCard(), changed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const operations = operationsSpy();
    const { onChanged } = renderPanel(pendingCard(), { operations });
    await userEvent.click(choice('Keep the data'));
    await userEvent.type(box(), 'Keep me');
    await userEvent.click(send());
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save. Try again.');
    expect(box().value).toBe('Keep me');
    expect(choice('Keep the data').getAttribute('aria-checked')).toBe('true');
    expect(operations.saveFailed).toHaveBeenCalledTimes(1);
    expect(onChanged).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(bodyOf(fetchMock.mock.calls[1] as unknown[])).toEqual({
      requestId: 'req-1',
      choiceId: 'keep',
      text: 'Keep me',
    });
  });

  it('shows the file, item and reason of a file_invalid answer and keeps the input', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: 'file_invalid',
              message: 'tasks/12/TASK.md is not valid.',
              reason: 'AC-1: A line starting with "- 根拠:" is missing.',
            },
          },
          422,
        ),
      ),
    );
    renderPanel();
    await userEvent.type(box(), 'Keep me');
    await userEvent.click(send());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('tasks/12/TASK.md');
    expect(alert.textContent).toContain('AC-1');
    expect(alert.textContent).toContain('A line starting with');
    expect(box().value).toBe('Keep me');
  });

  it('says the request changed on request_changed, keeps the text, and sends nothing old', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { code: 'request_changed', message: 'x', reason: 'changed.' } }, 409),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { onChanged } = renderPanel();
    await userEvent.type(box(), 'Old answer');
    await userEvent.click(send());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This request has changed. Review the latest board.',
    );
    expect(box().value).toBe('Old answer');
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows the latest request when the pending request changes under the form and sends with its id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ card: pendingCard(), changed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const first = pendingCard();
    const { rerender } = renderPanel(first);
    await userEvent.click(choice('Keep the data'));
    await userEvent.type(box(), 'Answer');
    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={{
          ...first,
          pendingRequestId: 'req-2',
          pendingReason: 'A new question',
          pendingChoices: [{ id: 'other', label: 'Another path' }],
        }}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    expect(screen.getByText('A new question')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      'This request has changed. Review the latest board.',
    );
    expect(screen.queryByRole('radio', { name: 'Keep the data' })).toBeNull();
    expect(box().value).toBe('Answer');
    await userEvent.click(send());
    expect(bodyOf(fetchMock.mock.calls[0] as unknown[])).toEqual({
      requestId: 'req-2',
      text: 'Answer',
    });
  });

  it('cuts a long question at four lines and shows all of it with Show more', async () => {
    const lineBox = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(200);
    const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(78);
    try {
      const { container } = renderPanel(pendingCard({ pendingReason: LONG }));
      const reason = container.querySelector('.detail__reason') as HTMLElement;
      expect(reason.className).toContain('detail__reason--clamped');
      await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
      expect(reason.className).not.toContain('detail__reason--clamped');
    } finally {
      lineBox.mockRestore();
      client.mockRestore();
    }
  });

  it('shows the resume notice after a saved answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ card: pendingCard(), changed: true })),
    );
    const { rerender, onChanged } = renderPanel();
    await userEvent.click(choice('Keep the data'));
    await userEvent.click(send());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={pendingCard({
          agentStatus: 'idle',
          pendingRequestId: null,
          pendingReason: null,
          pendingChoices: [],
        })}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    expect(screen.getByText('Saved. The coordinator resumes the work.')).toBeTruthy();
  });

  it('holds the project only while the answer has input', async () => {
    const operations = operationsSpy();
    renderPanel(pendingCard(), { operations });
    expect(operations.begin).not.toHaveBeenCalled();
    await userEvent.click(choice('Keep the data'));
    expect(operations.begin).toHaveBeenCalledWith('answer', PROJECT_A.id);
  });

  it('labels, hints and buttons in Japanese', async () => {
    selectLocale('ja');
    renderPanel();
    expect(screen.getByText('AIが回答を待っています')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '回答' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '送信' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy();
    expect(screen.getByText('選択肢を選ぶか、自由記述で回答できます。')).toBeTruthy();
  });
});
