import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitorClientError } from '../../src/pages/monitor/session';
import { unconnectedMonitorReadResolvers } from '../../src/pages/monitor/contracts';
import { MonitorProject } from '../../src/pages/monitor/MonitorProject';
import { selectLocale } from '../../src/shared/i18n';
import type { MessageDetail, MessagesApi } from '../../src/features/tasks/messages/model/messages';
import {
  changed,
  FakeAdapter,
  P,
  summaryOf,
  taskStream,
} from '../../src/shared/data/core/test-support';

let adapter: FakeAdapter;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  selectLocale('en');
  adapter = new FakeAdapter();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const read: MessagesApi['read'] = async (_projectId, id): Promise<MessageDetail> => ({
  id,
  type: 'question',
  body: 'Which one?',
  choices: [{ id: 'a', label: 'A' }],
  recommendedChoiceId: null,
  status: 'open',
  referencedBy: [1],
});

const tick = (ms = 0) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function mount(
  extra: {
    onNotFound?: () => void;
    useBuildReload?: () => void;
    answer?: MessagesApi['answer'];
  } = {},
) {
  return render(
    <MonitorProject
      projectId={P}
      adapter={adapter}
      readResolvers={unconnectedMonitorReadResolvers}
      messagesApi={{
        read,
        answer: extra.answer ?? (async () => Promise.reject(new Error('no answer'))),
        withdraw: async () => undefined,
      }}
      useBuildReload={extra.useBuildReload ?? (() => undefined)}
      onNotFound={extra.onNotFound ?? (() => undefined)}
    />,
  );
}

async function openAndLoad(summary = summaryOf([{ id: 1, document: 'd1', history: 'h1' }])) {
  await tick();
  act(() => adapter.handlers?.onOpen?.());
  await act(async () => {
    adapter.summaryCalls[0]?.resolve(summary);
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('MonitorProject', () => {
  it('reads the Summary of its project and draws the list from it, with no Detail', async () => {
    mount();
    await openAndLoad();
    expect(adapter.summaryCalls.map((call) => call.projectId)).toEqual([P]);
    expect(screen.getByRole('button', { name: 't1' })).toBeTruthy();
    expect(adapter.streamCalls).toHaveLength(0);
  });

  it('says so when the project is gone, instead of showing an empty list', async () => {
    const onNotFound = vi.fn();
    mount({ onNotFound });
    await tick();
    act(() => adapter.handlers?.onOpen?.());
    await act(async () => {
      adapter.summaryCalls[0]?.reject(new MonitorClientError('gone', 404, 'project_not_found'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onNotFound).toHaveBeenCalled();
  });

  it('holds automatic updates while the drawer is open and for 3 seconds after, but not a manual refresh', async () => {
    mount();
    await openAndLoad();
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTimeAsync(ms) });
    await user.click(screen.getByRole('button', { name: 't1' }));
    const dialog = screen.getByRole('dialog');
    await tick();
    expect(adapter.streamCalls).toHaveLength(1);

    // A change arrives while the drawer is open: nothing is read.
    act(() =>
      adapter.handlers?.onChanged(changed(1, [{ resource: 'task', id: 1, facets: ['summary'] }])),
    );
    await tick(1000);
    expect(adapter.summaryCalls).toHaveLength(1);

    // The drawer closes; the hold lasts 3 seconds more.
    await user.click(within(dialog).getByRole('button', { name: 'Close details' }));
    await tick(2000);
    expect(adapter.summaryCalls).toHaveLength(1);
    await tick(1500);
    expect(adapter.summaryCalls).toHaveLength(2);
  });

  it('reads again at once when a lane is pulled down, even while the drawer is open', async () => {
    mount();
    await openAndLoad();
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTimeAsync(ms) });
    await user.click(screen.getByRole('button', { name: 't1' }));
    await tick();
    expect(screen.queryByRole('button', { name: 'Refresh', hidden: true })).toBeNull();
    const list = document.querySelector('[data-lane="doing"] .monitor-lane__scroll') as HTMLElement;
    // The drawer makes the page inert for the user, so pull through the DOM.
    const finger = (type: 'touchStart' | 'touchMove' | 'touchEnd', y: number) => {
      const point = { clientX: 100, clientY: y, identifier: 1, target: list };
      act(() => {
        fireEvent[type](list, {
          touches: type === 'touchEnd' ? [] : [point],
          changedTouches: [point],
        });
      });
    };
    finger('touchStart', 100);
    finger('touchMove', 140);
    finger('touchMove', 260);
    expect(screen.getByText('Release to refresh', { selector: 'span' })).toBeTruthy();
    finger('touchEnd', 260);
    await tick();
    expect(adapter.summaryCalls).toHaveLength(2);
    expect(screen.getByText('Updating…', { selector: '.monitor-pull span' })).toBeTruthy();
    await act(async () => {
      adapter.summaryCalls[1]?.resolve(
        summaryOf([{ id: 1, document: 'd1', history: 'h1' }], 'sv2'),
      );
      await vi.advanceTimersByTimeAsync(1000);
    });
    await tick(1000);
    expect(document.querySelector('.monitor-pull')).toBeNull();
  });

  it('does not read a Detail for a change to a card that was never opened', async () => {
    mount();
    await openAndLoad();
    act(() =>
      adapter.handlers?.onChanged(
        changed(1, [{ resource: 'task', id: 1, facets: ['document', 'history'] }]),
      ),
    );
    await tick(1000);
    expect(adapter.streamCalls).toHaveLength(0);
  });

  it('does not read the body again when only the card changes lanes', async () => {
    mount();
    await openAndLoad();
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTimeAsync(ms) });
    await user.click(screen.getByRole('button', { name: 't1' }));
    await tick();
    await act(async () => {
      adapter.streamCalls[0]?.respond(taskStream(1, { document: 'd1', history: 'h1' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('dialog').textContent).toContain('body');
    await user.keyboard('{Escape}');
    await tick(3500);

    // The card moves to Doing: the Summary changes, the document version does not.
    act(() =>
      adapter.handlers?.onChanged(changed(1, [{ resource: 'task', id: 1, facets: ['summary'] }])),
    );
    await tick(500);
    const moved = summaryOf([{ id: 1, document: 'd1', history: 'h1' }], 'sv2');
    const [first] = moved.tasks;
    if (first) first.taskStatus = 'doing';
    await act(async () => {
      adapter.summaryCalls[1]?.resolve(moved);
      await vi.advanceTimersByTimeAsync(0);
    });
    await tick(500);
    expect(adapter.streamCalls).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Doing 1' })).toBeTruthy();
  });

  const pendingSummary = () => {
    const summary = summaryOf([{ id: 1, document: 'd1', history: 'h1' }]);
    Object.assign(summary.tasks[0] ?? {}, {
      taskStatus: 'doing',
      agentStatus: 'pending',
      pendingRequestId: 'r1',
      pendingReason: 'Which one?',
      pendingChoices: [{ id: 'a', label: 'A' }],
      questionIds: ['r1'],
      openQuestionIds: ['r1'],
    });
    summary.messages = [
      {
        id: 'r1',
        type: 'question',
        from: 'ai',
        to: 'human',
        turn: 'human',
        title: 'Which one?',
        createdAt: '2026-01-01T00:00:00Z',
        tasks: [1],
        epicId: null,
      },
    ];
    return summary;
  };

  it('does not hold the list while the answer sheet is open with input: a change is read at once', async () => {
    mount();
    const summary = pendingSummary();
    await openAndLoad(summary);
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTimeAsync(ms) });
    await user.click(
      within(screen.getByRole('article', { name: /Which one\?/ })).getByRole('button', {
        name: 'Answer the question',
      }),
    );
    await user.type(await screen.findByRole('textbox', { name: 'Note' }), 'Go with A');
    expect(adapter.summaryCalls).toHaveLength(1);

    // The sheet is open and has input; a change that arrives now is not made to wait.
    act(() =>
      adapter.handlers?.onChanged(changed(1, [{ resource: 'task', id: 1, facets: ['summary'] }])),
    );
    await tick(1000);
    expect(adapter.summaryCalls).toHaveLength(2);
  });

  it('shows an answer at once: the Summary is read again without waiting for the hold', async () => {
    const answer = vi.fn(async () => undefined);
    mount({ answer });
    await openAndLoad(pendingSummary());
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTimeAsync(ms) });
    await user.click(
      within(screen.getByRole('article', { name: /Which one\?/ })).getByRole('button', {
        name: 'Answer the question',
      }),
    );
    await user.click(await screen.findByRole('radio', { name: 'A' }));
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    await tick();
    expect(answer).toHaveBeenCalledTimes(1);
    expect(adapter.summaryCalls).toHaveLength(2);
  });

  it('waits for a new build while the list is open, and not after it is closed', async () => {
    const reloads: Array<boolean> = [];
    mount({
      useBuildReload: ((_served: string | null, busy: boolean) => void reloads.push(busy)) as never,
    });
    await openAndLoad(pendingSummary());
    expect(reloads.at(-1)).toBe(false);
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTimeAsync(ms) });
    await user.click(
      within(screen.getByRole('article', { name: /Which one\?/ })).getByRole('button', {
        name: 'Answer the question',
      }),
    );
    await user.type(await screen.findByRole('textbox', { name: 'Note' }), 'Go with A');
    expect(reloads.at(-1)).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Later' }));
    await tick(500);
    expect(reloads.at(-1)).toBe(false);
  });
});
