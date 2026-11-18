import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageCenter } from '../../src/features/tasks/messages/MessageCenter';
import {
  canSendAnswer,
  countMessages,
  firstQuestionOfTask,
  type MessageDetail,
  type MessagesApi,
  parseMessageDetail,
} from '../../src/features/tasks/messages/model/messages';
import { useMessagesPanel } from '../../src/features/tasks/messages/useMessagesPanel';
import type { Message } from '../../src/shared/data/api/contracts';
import { selectLocale } from '../../src/shared/i18n';
import { WriteError } from '../../src/shared/api/writeErrors';

const message = (over: Partial<Message> & Pick<Message, 'id' | 'type'>): Message => ({
  from: 'ai',
  to: 'human',
  turn: 'human',
  title: `Title of ${over.id}`,
  createdAt: '2026-11-17T08:40:00.000Z',
  tasks: [],
  epicId: null,
  ...over,
});

const MESSAGES: Message[] = [
  message({ id: 'Q-12', type: 'question', tasks: [21, 22] }),
  message({ id: 'Q-13', type: 'question', tasks: [14] }),
  message({ id: 'Q-14', type: 'request', from: 'human', to: 'ai', turn: 'ai' }),
];

const CHOICES = [
  { id: 'keep', label: 'Keep' },
  { id: 'drop', label: 'Drop' },
];

function api(over: Partial<MessagesApi> = {}): MessagesApi {
  return {
    read: vi.fn(
      async (_projectId: string, id: string): Promise<MessageDetail> => ({
        id,
        type: id === 'Q-14' ? 'request' : 'question',
        body: `The body of ${id}.`,
        choices: id === 'Q-14' ? [] : CHOICES,
        recommendedChoiceId: null,
        status: 'open',
        referencedBy: [],
      }),
    ),
    answer: vi.fn(async () => undefined),
    withdraw: vi.fn(async () => undefined),
    ...over,
  };
}

function Harness({
  routes,
  variant = 'board',
  messages = MESSAGES,
  onChanged = () => undefined,
}: {
  routes: MessagesApi;
  variant?: 'board' | 'phone';
  messages?: Message[];
  onChanged?: () => void;
}) {
  const panel = useMessagesPanel();
  return (
    <MessageCenter
      projectId="p"
      messages={messages}
      variant={variant}
      panel={panel}
      api={routes}
      onChanged={onChanged}
    />
  );
}

beforeEach(() => selectLocale('en'));

describe('messages model', () => {
  it('counts questions waiting on you, and your unpicked requests', () => {
    expect(countMessages(MESSAGES)).toEqual({ fromAi: 2, fromYou: 1 });
  });

  it('finds the first open question that a card waits on', () => {
    expect(firstQuestionOfTask(MESSAGES, 22)?.id).toBe('Q-12');
    expect(firstQuestionOfTask(MESSAGES, 99)).toBeNull();
  });

  it('requires a choice for a question with choices, and a note for one without', () => {
    expect(canSendAnswer(CHOICES, null, 'a note only')).toBe(false);
    expect(canSendAnswer(CHOICES, 'keep', '')).toBe(true);
    expect(canSendAnswer([], null, '   ')).toBe(false);
    expect(canSendAnswer([], null, 'ok')).toBe(true);
    expect(canSendAnswer([], null, 'x'.repeat(2001))).toBe(false);
  });

  it('parses a question and a request as the routes return them', () => {
    const question = parseMessageDetail({
      question: { id: 'Q-1', body: 'B', choices: CHOICES, status: 'open', referencedBy: [3] },
    });
    expect(question).toMatchObject({ id: 'Q-1', type: 'question', referencedBy: [3] });
    const request = parseMessageDetail({ request: { id: 'Q-2', body: 'R', status: 'open' } });
    expect(request).toMatchObject({ type: 'request', choices: [], status: 'open' });
    expect(() => parseMessageDetail({})).toThrow();
  });
});

describe('MessageCenter', () => {
  it('lists the open messages in two tabs with their states', async () => {
    const user = userEvent.setup();
    render(<Harness routes={api()} />);
    await user.click(screen.getByRole('button', { name: 'Questions & requests' }));
    const list = await screen.findByRole('dialog', { name: 'Messages' });
    expect(within(list).getAllByRole('tab')).toHaveLength(2);
    expect(within(list).getAllByText('Unanswered')).toHaveLength(2);
    await user.click(within(list).getByRole('tab', { name: /Your requests/ }));
    expect(within(list).getByText('Waiting to be picked up')).toBeTruthy();
  });

  it('sends one answer with its choice and note, and returns to the list', async () => {
    const user = userEvent.setup();
    const routes = api();
    const onChanged = vi.fn();
    render(<Harness routes={routes} onChanged={onChanged} />);
    await user.click(screen.getByRole('button', { name: 'Questions & requests' }));
    await user.click(await screen.findByRole('button', { name: /Title of Q-12/ }));
    const dialog = screen.getByRole('dialog');
    const send = await within(dialog).findByRole('button', { name: 'Send answer' });
    await user.type(await within(dialog).findByRole('textbox', { name: 'Note' }), 'why');
    expect((send as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(dialog).getByRole('radio', { name: 'Keep' }));
    await user.click(send);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(routes.answer).toHaveBeenCalledWith('p', [
      { questionId: 'Q-12', choiceId: 'keep', text: 'why' },
    ]);
    expect(await screen.findByRole('tab', { name: /AI's questions/ })).toBeTruthy();
  });

  it('says a question was changed elsewhere when the server answers 409', async () => {
    const user = userEvent.setup();
    const routes = api({
      answer: vi.fn(async () => {
        throw new WriteError('conflict', 409, 'conflict', null, null);
      }),
    });
    render(<Harness routes={routes} />);
    await user.click(screen.getByRole('button', { name: 'Questions & requests' }));
    await user.click(await screen.findByRole('button', { name: /Title of Q-13/ }));
    await user.click(await screen.findByRole('radio', { name: 'Drop' }));
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect((await screen.findByRole('alert')).textContent).toContain('answered elsewhere');
  });

  it('withdraws a request that waits to be picked up', async () => {
    const user = userEvent.setup();
    const routes = api();
    render(<Harness routes={routes} />);
    await user.click(screen.getByRole('button', { name: 'Questions & requests' }));
    await user.click(await screen.findByRole('tab', { name: /Your requests/ }));
    await user.click(screen.getByRole('button', { name: /Title of Q-14/ }));
    await user.click(await screen.findByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(routes.withdraw).toHaveBeenCalledWith('p', 'Q-14'));
  });

  it('uses a bottom sheet on the phone band, and "Ask AI" only when given', async () => {
    const onAsk = vi.fn();
    const routes = api();
    const Phone = () => {
      const panel = useMessagesPanel();
      return (
        <MessageCenter
          projectId="p"
          messages={MESSAGES}
          variant="phone"
          panel={panel}
          api={routes}
          onChanged={() => undefined}
          onAsk={onAsk}
        />
      );
    };
    const user = userEvent.setup();
    render(<Phone />);
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));
    expect(onAsk).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Questions & requests' }));
    expect((await screen.findByRole('dialog', { name: 'Messages' })).className).toContain(
      'surface-sheet',
    );
  });
});
