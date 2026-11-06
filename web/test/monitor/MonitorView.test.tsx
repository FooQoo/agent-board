import { useState } from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../../src/shared/i18n';
import { MonitorView } from '../../src/pages/monitor/View';
import type { AnswerWriter } from '../../src/features/tasks/answer/model/answer';
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
          pendingChoices: [
            { id: 'a', label: 'Include both' },
            { id: 'b', label: 'Choose one' },
          ],
          isDraft: true,
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

/** The view with the answer controller the page gives it. */
function Connected({
  writeAnswer,
  view = props(),
}: {
  writeAnswer?: AnswerWriter;
  view?: MonitorViewProps;
}) {
  const answerController = useMonitorInteractions({ writeAnswer });
  return <MonitorView {...view} answerController={answerController} />;
}

let setLiveView: (view: MonitorViewProps) => void = () => undefined;

/** The view with a board that changes under it, as the stream changes the page's. */
function Live({ initial }: { initial: MonitorViewProps }) {
  const [view, setView] = useState(initial);
  setLiveView = setView;
  return <Connected view={view} />;
}

const openButton = (card: HTMLElement) =>
  within(card).getByRole('button', { name: /Answer the question|Continue answering/ });
const todoCard = () => screen.getByRole('article', { name: /Todo decision/ });
const doingCard = () => screen.getByRole('article', { name: /Doing decision/ });
const sheet = (name: string) => screen.findByRole('dialog', { name });
const send = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: 'Send' }) as HTMLButtonElement;

describe('mobile monitor lanes and task actions', () => {
  it('counts tasks once by taskStatus and keeps run state inline', () => {
    render(<Connected />);

    expect(screen.getByRole('button', { name: '1Todo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2Doing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '1Done' })).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getAllByRole('heading', { name: /^(Todo 1|Doing 2|Done 1)$/ })).toHaveLength(3);
    expect(screen.queryByRole('heading', { name: /Pending|Running/ })).toBeNull();
    expect(screen.getAllByText('Pending')).toHaveLength(2);
    // A decision card shows the button only; the question is read in the sheet.
    expect(screen.getAllByRole('button', { name: 'Answer the question' })).toHaveLength(2);
    expect(screen.queryByText('Should the implementation use the shared form?')).toBeNull();
    expect(screen.getByText('Running')).toBeTruthy();
  });

  it('shows only the answer button on a decision card and still opens the body drawer', async () => {
    render(<Connected />);

    const title = screen.getByRole('button', { name: 'Todo decision' }) as HTMLButtonElement;
    expect(title.disabled).toBe(false);
    expect(screen.queryByText('Should the draft include both approaches?')).toBeNull();
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

describe('monitor answer sheet', () => {
  const answered = (taskId: number, taskStatus: 'todo' | 'doing') => ({
    task: makeTask({ id: taskId, taskStatus, agentStatus: 'idle', pendingRequestId: null }),
    changed: true,
  });

  it('opens the question in a sheet from the card button, with the send waiting for an input', async () => {
    const user = userEvent.setup();
    render(<Connected />);
    await user.click(openButton(todoCard()));

    const dialog = await sheet('Todo decision');
    expect(within(dialog).getByText('Should the draft include both approaches?')).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: 'Include both' })).toBeTruthy();
    expect(send(dialog).disabled).toBe(true);
    await user.click(within(dialog).getByRole('radio', { name: 'Choose one' }));
    expect(send(dialog).disabled).toBe(false);
  });

  it('answers Todo and Doing tasks from the sheet, closes it, and prevents resubmission', async () => {
    const writeAnswer = vi.fn(async (_projectId: string, taskId: number) =>
      answered(taskId, taskId === 1 ? 'todo' : 'doing'),
    );
    const user = userEvent.setup();
    render(<Connected writeAnswer={writeAnswer} />);

    await user.click(openButton(todoCard()));
    let dialog = await sheet('Todo decision');
    await user.type(within(dialog).getByRole('textbox'), 'Keep both approaches');
    await user.click(send(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(openButton(doingCard()));
    dialog = await sheet('Doing decision');
    await user.click(within(dialog).getByRole('radio', { name: 'Use the shared form' }));
    await user.click(send(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(writeAnswer).toHaveBeenNthCalledWith(1, PROJECT_A.id, 1, {
      requestId: 'request-1',
      text: 'Keep both approaches',
    });
    expect(writeAnswer).toHaveBeenNthCalledWith(2, PROJECT_A.id, 4, {
      requestId: 'request-4',
      choiceId: 'shared',
    });
  });

  it('keeps the input when the sheet is closed, and the button then says to continue', async () => {
    const user = userEvent.setup();
    render(<Connected />);
    await user.click(openButton(todoCard()));
    const dialog = await sheet('Todo decision');
    await user.type(within(dialog).getByRole('textbox'), 'Half written');
    await user.click(within(dialog).getByRole('button', { name: 'Close the answer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(openButton(todoCard()).textContent).toBe('Continue answering');
    expect(openButton(doingCard()).textContent).toBe('Answer the question');
    await user.click(openButton(todoCard()));
    const again = await sheet('Todo decision');
    expect((within(again).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Half written');
  });

  it('keeps the text after a failed save and sends it again when Retry is chosen', async () => {
    const writeAnswer = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(answered(1, 'todo'));
    const user = userEvent.setup();
    render(<Connected writeAnswer={writeAnswer} />);
    await user.click(openButton(todoCard()));
    const dialog = await sheet('Todo decision');
    const textarea = within(dialog).getByRole('textbox') as HTMLTextAreaElement;
    await user.type(textarea, 'Keep my response');
    await user.click(send(dialog));
    expect(textarea.value).toBe('Keep my response');
    await user.click(await within(dialog).findByRole('button', { name: 'Retry' }));
    expect(writeAnswer).toHaveBeenCalledTimes(2);
    expect(writeAnswer).toHaveBeenLastCalledWith(PROJECT_A.id, 1, {
      requestId: 'request-1',
      text: 'Keep my response',
    });
  });

  it('clears the input only when asked, and only while there is input', async () => {
    const user = userEvent.setup();
    render(<Connected />);
    await user.click(openButton(todoCard()));
    const dialog = await sheet('Todo decision');
    expect(within(dialog).queryByRole('button', { name: 'Clear' })).toBeNull();
    await user.type(within(dialog).getByRole('textbox'), 'draft');
    await user.click(within(dialog).getByRole('button', { name: 'Clear' }));
    expect((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    expect(within(dialog).queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('follows a replaced question and a withdrawn one while it is open', async () => {
    const user = userEvent.setup();
    const asking = (reason: string | null, requestId: string | null) =>
      props({
        todo: [
          item(
            makeTask({
              id: 1,
              title: 'Todo decision',
              taskStatus: 'todo',
              agentStatus: requestId === null ? 'idle' : 'pending',
              pendingReason: reason,
              pendingRequestId: requestId,
              pendingChoices: requestId === null ? [] : [{ id: 'a', label: 'Include both' }],
            }),
          ),
        ],
      });
    render(<Live initial={asking('First question?', 'request-1')} />);
    await user.click(openButton(todoCard()));
    const dialog = await sheet('Todo decision');
    await user.type(within(dialog).getByRole('textbox'), 'my note');
    await user.click(within(dialog).getByRole('radio', { name: 'Include both' }));

    act(() => setLiveView(asking('Second question?', 'request-2')));
    expect(await within(dialog).findByText('Second question?')).toBeTruthy();
    expect(within(dialog).getByText(/The question has changed/)).toBeTruthy();
    expect(
      within(dialog).getByRole('radio', { name: 'Include both' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value).toBe('my note');

    act(() => setLiveView(asking(null, null)));
    expect(await within(dialog).findByText(/This question was withdrawn/)).toBeTruthy();
    expect(within(dialog).getByText('Second question?')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Send' })).toBeNull();
    // The open sheet shows the input itself; the banner of left-behind input is for closed ones.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('holds only while an answer is on its way, not while the sheet is open', async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    const writeAnswer = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve(answered(1, 'todo'));
        }),
    ) as unknown as AnswerWriter;
    let controller: ReturnType<typeof useMonitorInteractions> | undefined;
    function Probe() {
      controller = useMonitorInteractions({ writeAnswer });
      return <MonitorView {...props()} answerController={controller} />;
    }
    render(<Probe />);
    await user.click(openButton(todoCard()));
    const dialog = await sheet('Todo decision');
    await user.type(within(dialog).getByRole('textbox'), 'typing');
    expect(controller?.sending).toBe(false);
    expect(controller?.hasAnyDraft()).toBe(true);

    await user.click(send(dialog));
    expect(controller?.sending).toBe(true);
    await act(async () => release?.());
    await waitFor(() => expect(controller?.sending).toBe(false));
    expect(controller?.hasAnyDraft()).toBe(false);
  });

  it('lists input left behind by a withdrawn question once its sheet is closed', async () => {
    const user = userEvent.setup();
    const withdrawn = props({
      todo: [
        item(makeTask({ id: 1, title: 'Todo decision', taskStatus: 'todo', agentStatus: 'idle' })),
      ],
    });
    render(<Live initial={props()} />);
    await user.click(openButton(todoCard()));
    const dialog = await sheet('Todo decision');
    await user.type(within(dialog).getByRole('textbox'), 'left behind');
    act(() => setLiveView(withdrawn));
    await within(dialog).findByText(/This question was withdrawn/);
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Close the answer' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('left behind'));
  });
});
