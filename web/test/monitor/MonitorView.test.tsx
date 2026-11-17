import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../../src/shared/i18n';
import { MonitorView } from '../../src/pages/monitor/View';
import type {
  AnswersWriter,
  BandQuestion,
  QuestionDetail,
} from '../../src/features/tasks/answer/model/qa';
import type {
  MonitorTask,
  MonitorFreshness,
  MonitorViewProps,
} from '../../src/pages/monitor/contracts';
import { PROJECT_A, makeTask } from '../fixtures';
import { useMonitorInteractions } from '../../src/pages/monitor/hooks/useMonitorInteractions';
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

const QUESTIONS: BandQuestion[] = [
  { id: 'Q-1', title: '## Should the draft include both approaches?', referencedBy: [1] },
  { id: 'Q-4', title: '## Should the implementation use the shared form?', referencedBy: [4] },
];

async function readQuestion(_projectId: string, id: string): Promise<QuestionDetail> {
  const found = QUESTIONS.find((question) => question.id === id);
  return {
    id,
    question: found?.title ?? '',
    choices: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
    recommendedChoiceId: null,
    status: 'open',
    referencedBy: found?.referencedBy ?? [],
  };
}

/** The view with the answer controller the page gives it. */
function Connected({
  write = vi.fn(async () => {}),
  view = props(),
  questions = QUESTIONS,
  onSent = () => undefined,
}: {
  write?: AnswersWriter;
  view?: MonitorViewProps;
  questions?: BandQuestion[];
  onSent?: () => void;
}) {
  const { book } = useMonitorInteractions();
  book.reconcile(PROJECT_A.id, questions);
  return (
    <MonitorView
      {...view}
      projectId={PROJECT_A.id}
      questions={questions}
      onAnswersSent={onSent}
      answerController={{ book, read: readQuestion, write }}
    />
  );
}

const openButton = (card: HTMLElement) =>
  within(card).getByRole('button', { name: /Answer the question|Continue answering/ });
const todoCard = () => screen.getByRole('article', { name: /Todo decision/ });
const band = () => screen.getByRole('region', { name: 'Unanswered questions' });

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

describe('monitor question band and answer sheet', () => {
  it('lists the open questions in a band under the counts, closed until its header is pressed', async () => {
    const user = userEvent.setup();
    render(<Connected />);
    const toggle = within(band()).getByRole('button', { name: /^Show unanswered questions/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(band()).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(band()).getByText('2')).toBeTruthy();
    expect(within(band()).getByRole('button', { name: 'Answer them' })).toBeTruthy();
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(band()).getAllByRole('listitem')).toHaveLength(2);
    expect(within(band()).getByText('#4')).toBeTruthy();
    expect(within(band()).getByRole('button', { name: 'Answer them' })).toBeTruthy();
  });

  it('keeps the band with a count of 0 and nothing to open when nothing is open', () => {
    render(<Connected questions={[]} />);
    expect(within(band()).getByText('0')).toBeTruthy();
    const toggle = within(band()).getByRole('button', { name: /^Show unanswered questions/ });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(within(band()).queryByRole('list')).toBeNull();
  });

  it('opens only the questions of a card in the sheet and sends its answer at once', async () => {
    const user = userEvent.setup();
    const write = vi.fn(async () => {});
    const onSent = vi.fn();
    render(<Connected write={write} onSent={onSent} />);
    await user.click(openButton(todoCard()));
    const sheet = await screen.findByRole('dialog', { name: 'Todo decision' });
    expect(within(sheet).getByText('1 / 1')).toBeTruthy();
    const send = within(sheet).getByRole('button', { name: /^Send$/ });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    await user.click(await within(sheet).findByRole('radio', { name: 'Yes' }));
    expect(within(sheet).getByText('1 answered, not sent')).toBeTruthy();
    await user.click(send);
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledWith(PROJECT_A.id, [{ questionId: 'Q-1', choiceId: 'yes' }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('sends from a card only its own answers, and keeps an answer held for another card', async () => {
    const user = userEvent.setup();
    const write = vi.fn(async () => {});
    render(<Connected write={write} />);
    await user.click(within(band()).getByRole('button', { name: 'Answer them' }));
    let sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Next' }));
    await user.type(await within(sheet).findByRole('textbox', { name: 'Note' }), 'Later');
    await user.click(within(sheet).getByRole('button', { name: 'Close the answer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(openButton(todoCard()));
    sheet = await screen.findByRole('dialog', { name: 'Todo decision' });
    await user.click(await within(sheet).findByRole('radio', { name: 'Yes' }));
    await user.click(within(sheet).getByRole('button', { name: /^Send$/ }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledWith(PROJECT_A.id, [{ questionId: 'Q-1', choiceId: 'yes' }]);
    // The sent question leaves the band at once; the one held for the other card stays.
    await user.click(within(band()).getByRole('button', { name: /^Show unanswered questions/ }));
    await waitFor(() => expect(within(band()).getAllByRole('listitem')).toHaveLength(1));
    expect(within(band()).getByText('#4')).toBeTruthy();
    expect(within(band()).getByRole('button', { name: 'Review and send' })).toBeTruthy();
  });

  it('keeps the answers when the sheet is closed, and the band and the card offer to go on', async () => {
    const user = userEvent.setup();
    render(<Connected />);
    await user.click(within(band()).getByRole('button', { name: 'Answer them' }));
    const sheet = await screen.findByRole('dialog');
    await user.click(await within(sheet).findByRole('radio', { name: 'No' }));
    await user.click(within(sheet).getByRole('button', { name: 'Close the answer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(band()).getByRole('button', { name: 'Review and send' })).toBeTruthy();
    await user.click(within(band()).getByRole('button', { name: /^Show unanswered questions/ }));
    expect(within(band()).getByText('Answered, not sent')).toBeTruthy();
    expect(openButton(todoCard()).textContent).toBe('Continue answering');
  });

  it('keeps the answers after a failed send and sends them again', async () => {
    const user = userEvent.setup();
    const write = vi
      .fn<AnswersWriter>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const onSent = vi.fn();
    render(<Connected write={write} onSent={onSent} />);
    await user.click(openButton(todoCard()));
    const sheet = await screen.findByRole('dialog');
    await user.click(await within(sheet).findByRole('radio', { name: 'Yes' }));
    await user.click(within(sheet).getByRole('button', { name: /^Send$/ }));
    expect(await within(sheet).findByRole('alert')).toBeTruthy();
    await user.click(within(sheet).getByRole('button', { name: /^Send$/ }));
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledTimes(2);
  });
});
