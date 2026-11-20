import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../../src/shared/i18n';
import { MonitorView } from '../../src/pages/monitor/View';
import type {
  AnswerItem,
  MessageDetail,
  MessagesApi,
} from '../../src/features/tasks/messages/model/messages';
import type { Message } from '../../src/shared/data/api/contracts';
import type {
  MonitorTask,
  MonitorFreshness,
  MonitorViewProps,
} from '../../src/pages/monitor/contracts';
import { PROJECT_A, makeTask } from '../fixtures';
import { renderWithData as render } from './support';

beforeEach(() => selectLocale('en'));

const freshness: MonitorFreshness = {
  state: 'fresh',
  lastFetchedAt: '2026-10-12T00:00:00Z',
  snapshotProblems: [],
};

function item(task: MonitorTask['task']): MonitorTask {
  return { projectId: PROJECT_A.id, projectName: PROJECT_A.name, task };
}

function props(overrides: Partial<MonitorViewProps> = {}): MonitorViewProps {
  return {
    summary: { todo: 1, doing: 2, done: 1 },
    todo: [
      item(
        makeTask({
          id: 1,
          title: 'Todo decision',
          taskStatus: 'todo',
          agentStatus: 'pending',
          pendingReason: 'Should the draft include both approaches?',
          pendingRequestId: 'request-1',
          openQuestionIds: ['Q-1'],
          pendingChoices: [
            { id: 'a', label: 'Include both' },
            { id: 'b', label: 'Choose one' },
          ],
          draft: 'human',
        }),
      ),
    ],
    doing: [
      item(
        makeTask({
          id: 2,
          title: 'Doing running',
          taskStatus: 'doing',
          agentStatus: 'running',
        }),
      ),
      item(
        makeTask({
          id: 4,
          title: 'Doing decision',
          taskStatus: 'doing',
          agentStatus: 'pending',
          pendingReason: 'Should the implementation use the shared form?',
          pendingRequestId: 'request-4',
          openQuestionIds: ['Q-4'],
          pendingChoices: [{ id: 'shared', label: 'Use the shared form' }],
        }),
      ),
    ],
    done: [item(makeTask({ id: 3, title: 'Done', taskStatus: 'done' }))],
    freshness,
    onRefresh: () => undefined,
    ...overrides,
  };
}

const question = (id: string, title: string, tasks: number[]): Message => ({
  id,
  type: 'question',
  from: 'ai',
  to: 'human',
  turn: 'human',
  title,
  createdAt: '2026-10-12T00:00:00Z',
  tasks,
  epicId: null,
});
const request = (id: string, title: string): Message => ({
  id,
  type: 'request',
  from: 'human',
  to: 'ai',
  turn: 'ai',
  title,
  createdAt: '2026-10-12T01:00:00Z',
  tasks: [],
  epicId: null,
});

const MESSAGES: Message[] = [
  question('Q-1', 'Should the draft include both approaches?', [1]),
  question('Q-4', 'Should the implementation use the shared form?', [4]),
  request('Q-6', 'Add a forgot-password link'),
];

async function read(_projectId: string, id: string): Promise<MessageDetail> {
  const found = MESSAGES.find((message) => message.id === id);
  return {
    id,
    type: found?.type === 'request' ? 'request' : 'question',
    body: `## ${found?.title ?? ''}`,
    choices:
      found?.type === 'question'
        ? [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ]
        : [],
    recommendedChoiceId: null,
    status: 'open',
    referencedBy: found?.tasks ?? [],
  };
}

/** The view with the messages the page gives it. */
function Connected({
  answer = vi.fn(async () => {}),
  withdraw = vi.fn(async () => {}),
  view = props(),
  messages = MESSAGES,
  onChanged = () => undefined,
  onAsk,
}: {
  answer?: MessagesApi['answer'];
  withdraw?: MessagesApi['withdraw'];
  view?: MonitorViewProps;
  messages?: Message[];
  onChanged?: () => void;
  onAsk?: () => void;
}) {
  return (
    <MonitorView
      {...view}
      projectId={PROJECT_A.id}
      messages={messages}
      onMessagesChanged={onChanged}
      onAsk={onAsk}
      messagesApi={{ read, answer, withdraw }}
    />
  );
}

const openButton = (card: HTMLElement) =>
  within(card).getByRole('button', { name: 'Answer the question' });
const todoCard = () => screen.getByRole('article', { name: /Todo decision/ });
const bar = () => screen.getByRole('navigation', { name: 'Main navigation' });
const messagesItem = (name: string | RegExp = /^Messages/) =>
  within(bar()).getByRole('button', { name });

describe('remote access lanes and task actions', () => {
  it('counts tasks once by taskStatus and keeps run state inline', () => {
    render(<Connected />);

    expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'))).toEqual([
      'Todo 1',
      'Doing 2',
      'Done 1',
    ]);
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.queryByRole('heading', { name: /Pending|Running/ })).toBeNull();
    expect(screen.getAllByText('Pending')).toHaveLength(2);
    // A decision card shows the button only; the question is read in the sheet.
    expect(screen.getAllByRole('button', { name: 'Answer the question' })).toHaveLength(2);
    expect(
      within(screen.getByRole('article', { name: /Doing decision/ })).queryByText(
        'Should the implementation use the shared form?',
      ),
    ).toBeNull();
    expect(screen.getByText('Running')).toBeTruthy();
  });

  it('shows only the answer button on a decision card and still opens the body drawer', async () => {
    render(<Connected />);

    const title = screen.getByRole('button', { name: 'Todo decision' }) as HTMLButtonElement;
    expect(title.disabled).toBe(false);
    expect(within(todoCard()).queryByText('Should the draft include both approaches?')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    await userEvent.click(title);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Todo decision' })).toBeTruthy();
    expect(within(dialog).getByRole('tab', { name: 'Body' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('reports title and epic-label actions as distinct drawer tabs', async () => {
    const onOpenDetail = vi.fn();
    const target = item(
      makeTask({
        id: 4,
        title: 'Linked task',
        epic: { id: 'MOB-1', name: 'Mobile interaction', color: '#4466aa' },
      }),
    );
    const user = userEvent.setup();
    render(<MonitorView {...props({ todo: [target], doing: [], done: [], onOpenDetail })} />);

    await user.click(screen.getByRole('button', { name: 'Linked task' }));
    expect(onOpenDetail).toHaveBeenLastCalledWith(target, 'description');
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close details' }),
    );
    await user.click(screen.getByRole('button', { name: 'MOB-1' }));
    expect(onOpenDetail).toHaveBeenLastCalledWith(target, 'epic');
    expect(onOpenDetail).toHaveBeenCalledTimes(2);
    expect(
      within(screen.getByRole('dialog'))
        .getByRole('tab', { name: 'Epic' })
        .getAttribute('aria-selected'),
    ).toBe('true');
  });
});

describe('monitor messages in the bottom bar', () => {
  it('counts the open questions on Messages, and not the requests', () => {
    render(<Connected />);
    // Two questions and one request are open: only the questions are counted.
    expect(messagesItem().getAttribute('aria-label')).toBe('Messages 2');
    expect(messagesItem().textContent).toContain('2');
  });

  it('shows no count on Messages when nothing is open', () => {
    render(<Connected messages={[]} />);
    expect(messagesItem().getAttribute('aria-label')).toBe('Messages');
    expect(messagesItem().querySelector('.phone-nav__badge')).toBeNull();
  });

  it('opens "Ask AI" from the middle item of the bar', async () => {
    const onAsk = vi.fn();
    render(<Connected onAsk={onAsk} />);
    const items = within(bar()).getAllByRole('button');
    expect(items.map((item) => item.textContent?.replace(/^\d+/, ''))).toEqual([
      'Board',
      'Messages',
      'Ask',
      'Archive',
      'Settings',
    ]);
    await userEvent.click(within(bar()).getByRole('button', { name: 'Ask AI' }));
    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it('has no message band, no header settings button and no Ask AI button in the screen', () => {
    const { container } = render(<Connected onAsk={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Messages' })).toBeNull();
    expect(container.querySelector('.header__settings')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Ask AI' })).toHaveLength(1);
  });

  it('opens settings from the bar, and dims Archive while there is nothing to archive', async () => {
    const user = userEvent.setup();
    render(<Connected />);
    // Without writes (and with no done card to move) the archive item cannot be tapped.
    expect(
      (within(bar()).getByRole('button', { name: 'Archive all' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(within(bar()).getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy();
  });

  it('opens the list as a sheet with the two tabs, without an Ask AI entry, and never lists a closed message', async () => {
    const user = userEvent.setup();
    render(<Connected onAsk={vi.fn()} />);
    await user.click(messagesItem());
    const sheet = await screen.findByRole('dialog', { name: 'Messages' });
    expect(within(sheet).queryByRole('button', { name: /Ask/ })).toBeNull();
    expect(within(sheet).getAllByRole('tab')).toHaveLength(2);
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(2);
    expect(within(sheet).getAllByText('Unanswered')).toHaveLength(2);
    await user.click(within(sheet).getByRole('tab', { name: /Your requests/ }));
    expect(
      within(sheet).getByText('Waiting to be picked up', { selector: '[data-slot=badge]' }),
    ).toBeTruthy();
  });

  it("opens a card's question and sends a choice, then goes back to the list", async () => {
    const user = userEvent.setup();
    const answer = vi.fn(async (_projectId: string, _answers: AnswerItem[]) => {});
    const onChanged = vi.fn();
    render(<Connected answer={answer} onChanged={onChanged} />);
    await user.click(openButton(todoCard()));
    const sheet = await screen.findByRole('dialog', { name: 'Messages' });
    const send = within(sheet).getByRole('button', { name: 'Send answer' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    // A note alone is an answer too; here it is sent together with a choice.
    await user.type(await within(sheet).findByRole('textbox', { name: 'Note' }), 'maybe');
    expect((send as HTMLButtonElement).disabled).toBe(false);
    await user.click(await within(sheet).findByRole('radio', { name: 'Yes' }));
    expect((send as HTMLButtonElement).disabled).toBe(false);
    await user.click(send);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(answer).toHaveBeenCalledWith(
      PROJECT_A.id,
      [{ questionId: 'Q-1', choiceId: 'yes', text: 'maybe' }],
      [],
    );
  });

  it('keeps the input and says so after a failed send', async () => {
    const user = userEvent.setup();
    const answer = vi.fn(async () => Promise.reject(new Error('offline')));
    render(<Connected answer={answer} />);
    await user.click(openButton(todoCard()));
    const sheet = await screen.findByRole('dialog');
    await user.click(await within(sheet).findByRole('radio', { name: 'Yes' }));
    await user.click(within(sheet).getByRole('button', { name: 'Send answer' }));
    expect(await within(sheet).findByRole('alert')).toBeTruthy();
    expect(
      (within(sheet).getByRole('radio', { name: 'Yes' }) as HTMLButtonElement).getAttribute(
        'aria-checked',
      ),
    ).toBe('true');
  });

  it('closes the list with "Later" and sends nothing', async () => {
    const user = userEvent.setup();
    const answer = vi.fn(async () => {});
    render(<Connected answer={answer} />);
    await user.click(openButton(todoCard()));
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(answer).not.toHaveBeenCalled();
  });

  it('shows an open request and withdraws it while it waits', async () => {
    const user = userEvent.setup();
    const withdraw = vi.fn(async () => {});
    const onChanged = vi.fn();
    render(<Connected withdraw={withdraw} onChanged={onChanged} />);
    await user.click(messagesItem());
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('tab', { name: /Your requests/ }));
    await user.click(within(sheet).getByRole('button', { name: /Add a forgot-password link/ }));
    await user.click(await within(sheet).findByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith(PROJECT_A.id, 'Q-6'));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
