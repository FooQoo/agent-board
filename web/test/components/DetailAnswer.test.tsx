import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Card } from '../../src/components/Card';
import { useCardAnswers } from '../../src/hooks/useCardAnswers';
import { selectLocale } from '../../src/i18n';
import type { AnswerLeaseChange } from '../../src/hooks/useCardAnswers';
import type { Card as CardModel } from '../../src/types';
import { deferred, jsonResponse } from '../fakes';
import { PROJECT_A, makeCard } from '../fixtures';

const LONG =
  'It is unclear whether to keep the existing data or start from scratch. There are three options: replace the old board, export it and import a new one, or keep both for now. Please decide which one to use.';
const pendingCard = (overrides: Partial<CardModel> = {}): CardModel =>
  makeCard({
    id: 12,
    title: 'Pending card',
    cardStatus: 'todo',
    agentStatus: 'pending',
    pendingRequestId: 'req-1',
    pendingReason: 'Which way should the board go?',
    pendingChoices: [
      { id: 'keep', label: 'Keep the data' },
      { id: 'reset', label: 'Start over' },
    ],
    ...overrides,
  });

function renderPendingCard(
  card: CardModel = pendingCard(),
  onLeaseChange: AnswerLeaseChange = vi.fn(),
) {
  function Harness({ value }: { value: CardModel }) {
    const answers = useCardAnswers(onLeaseChange);
    return (
      <Card
        card={value}
        selected={false}
        onSelect={vi.fn()}
        projectId={PROJECT_A.id}
        answers={answers}
        syncedAt={new Date('2026-10-12T01:00:00Z')}
      />
    );
  }
  const utils = render(<Harness value={card} />);
  return {
    ...utils,
    rerenderCard: (next: CardModel) => utils.rerender(<Harness value={next} />),
  };
}

const request = (container: HTMLElement) =>
  container.querySelector('.card__answer .detail__request') as HTMLElement;
const box = () => screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement;
const send = () => screen.getByRole('button', { name: /^(Send|Retry)$/ }) as HTMLButtonElement;
const choice = (label: string) => screen.getByRole('radio', { name: label });
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

beforeEach(() => {
  selectLocale('en');
  document.head.innerHTML = '<meta name="agboard-token" content="test-token">';
});

describe('PC card answer form', () => {
  it('shows the current Todo request and choices directly on the card', () => {
    const { container } = renderPendingCard();
    expect(request(container).textContent).toContain('Which way should the board go?');
    expect(within(request(container)).getAllByRole('radio')).toHaveLength(2);
    expect(box().value).toBe('');
    expect(send().disabled).toBe(true);
  });

  it('shows only the text box when the request has no choices', () => {
    renderPendingCard(pendingCard({ pendingChoices: [] }));
    expect(screen.queryByRole('radio')).toBeNull();
    expect(box()).toBeTruthy();
    expect(send().disabled).toBe(true);
  });

  it('enables Send for a choice or non-blank text and sends the current request id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ card: pendingCard(), changed: true }));
    vi.stubGlobal('fetch', fetchMock);
    renderPendingCard();
    await userEvent.type(box(), '   ');
    expect(send().disabled).toBe(true);
    await userEvent.click(choice('Start over'));
    expect(send().disabled).toBe(false);
    await userEvent.click(send());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      `/api/projects/${PROJECT_A.id}/cards/12/answer`,
    );
    expect(bodyOf(fetchMock.mock.calls[0] as unknown[])).toEqual({
      requestId: 'req-1',
      choiceId: 'reset',
    });
  });

  it('prevents duplicate sends and keeps the form locked during the request', async () => {
    const gate = deferred<Response>();
    const fetchMock = vi.fn(() => gate.promise);
    vi.stubGlobal('fetch', fetchMock);
    renderPendingCard();
    await userEvent.type(box(), 'Go');
    await userEvent.click(send());
    expect(screen.getByRole('button', { name: 'Sending…' })).toHaveProperty('disabled', true);
    expect(box().disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Sending…' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    gate.resolve(jsonResponse({ card: pendingCard(), changed: true }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sending…' })).toBeNull());
  });

  it('keeps the input after a save failure and retries the same answer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'database_busy', message: 'x', reason: 'busy' } }, 503),
      )
      .mockResolvedValueOnce(jsonResponse({ card: pendingCard(), changed: true }));
    vi.stubGlobal('fetch', fetchMock);
    renderPendingCard();
    await userEvent.click(choice('Keep the data'));
    await userEvent.type(box(), 'Keep me');
    await userEvent.click(send());
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save. Try again.');
    expect(box().value).toBe('Keep me');
    expect(choice('Keep the data').getAttribute('aria-checked')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodyOf(fetchMock.mock.calls[1] as unknown[])).toEqual({
      requestId: 'req-1',
      choiceId: 'keep',
      text: 'Keep me',
    });
  });

  it('keeps an old draft but prevents sending it after the request changes', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { code: 'request_changed', message: 'x', reason: 'changed.' } }, 409),
    );
    vi.stubGlobal('fetch', fetchMock);
    const first = pendingCard();
    const { container, rerenderCard } = renderPendingCard(first);
    await userEvent.click(choice('Keep the data'));
    await userEvent.type(box(), 'Old answer');
    rerenderCard(
      pendingCard({
        pendingRequestId: 'req-2',
        pendingReason: 'A new question',
        pendingChoices: [{ id: 'other', label: 'Another path' }],
      }),
    );
    expect(request(container).textContent).toContain('A new question');
    expect(screen.getByRole('alert').textContent).toBe(
      'This request has changed. Review the latest board.',
    );
    expect(screen.queryByRole('radio', { name: 'Keep the data' })).toBeNull();
    expect(box().value).toBe('Old answer');
    expect(send().disabled).toBe(true);
    await userEvent.type(box(), ' again');
    await userEvent.click(send());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyOf(fetchMock.mock.calls[0] as unknown[])).toEqual({
      requestId: 'req-2',
      text: 'Old answer again',
    });
  });

  it('cuts a long question to four lines and lets the user expand it', async () => {
    const lineBox = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(200);
    const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(78);
    try {
      const { container } = renderPendingCard(pendingCard({ pendingReason: LONG }));
      const reason = request(container).querySelector('.detail__reason') as HTMLElement;
      expect(reason.className).toContain('detail__reason--clamped');
      await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
      expect(reason.className).not.toContain('detail__reason--clamped');
    } finally {
      lineBox.mockRestore();
      client.mockRestore();
    }
  });

  it('keeps labels, hints and buttons in Japanese', async () => {
    selectLocale('ja');
    renderPendingCard();
    expect(screen.getByText('AIが回答を待っています')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '回答' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '送信' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy();
    expect(screen.getByText('選択肢を選ぶか、自由記述で回答できます。')).toBeTruthy();
  });
});
