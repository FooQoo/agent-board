import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitorClientError } from '../../src/pages/monitor/client';
import { MonitorProject } from '../../src/pages/monitor/MonitorProject';
import { selectLocale } from '../../src/shared/i18n';
import type { AnswerWriter } from '../../src/features/tasks/answer/model/answer';
import { makeTask } from '../fixtures';
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

const tick = (ms = 0) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function mount(
  extra: { onNotFound?: () => void; useBuildReload?: () => void; writeAnswer?: AnswerWriter } = {},
) {
  return render(
    <MonitorProject
      projectId={P}
      adapter={adapter}
      writeAnswer={extra.writeAnswer ?? (async () => Promise.reject(new Error('no answer')))}
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

  it('reads again at once when the refresh button is pressed, even while the drawer is open', async () => {
    mount();
    await openAndLoad();
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTimeAsync(ms) });
    await user.click(screen.getByRole('button', { name: 't1' }));
    await tick();
    const refresh = screen
      .getAllByRole('button', { name: 'Refresh', hidden: true })
      .find((button) => !button.closest('[role="dialog"]'));
    expect(refresh).toBeTruthy();
    // The drawer makes the page inert for the user, so ask through the DOM.
    act(() => (refresh as HTMLButtonElement).click());
    await tick();
    expect(adapter.summaryCalls).toHaveLength(2);
    expect((refresh as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      adapter.summaryCalls[1]?.resolve(
        summaryOf([{ id: 1, document: 'd1', history: 'h1' }], 'sv2'),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    expect((refresh as HTMLButtonElement).disabled).toBe(false);
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
      adapter.streamCalls[0]?.respond(taskStream(1, { document: 'd1' }));
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
    expect(screen.getByRole('heading', { name: /Doing 1/ })).toBeTruthy();
  });

  it('shows an answer at once: the Summary is read again without waiting for the hold', async () => {
    const writeAnswer = vi.fn(async () => ({
      task: makeTask({ id: 1, taskStatus: 'doing', agentStatus: 'idle', pendingRequestId: null }),
      changed: true,
    }));
    mount({ writeAnswer });
    const summary = summaryOf([{ id: 1, document: 'd1', history: 'h1' }]);
    Object.assign(summary.tasks[0] ?? {}, {
      taskStatus: 'doing',
      agentStatus: 'pending',
      pendingRequestId: 'r1',
      pendingReason: 'Which one?',
      pendingChoices: [{ id: 'a', label: 'A' }],
    });
    await openAndLoad(summary);
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTimeAsync(ms) });
    const card = screen.getByRole('article', { name: /Which one\?/ });
    await user.type(within(card).getByRole('textbox'), 'Go with A');
    // Typing an answer holds automatic updates: a change that arrives now waits.
    act(() =>
      adapter.handlers?.onChanged(changed(1, [{ resource: 'task', id: 1, facets: ['summary'] }])),
    );
    await tick(1000);
    expect(adapter.summaryCalls).toHaveLength(1);

    await user.click(within(card).getByRole('button', { name: 'Send' }));
    await tick();
    expect(writeAnswer).toHaveBeenCalledTimes(1);
    expect(adapter.summaryCalls).toHaveLength(2);
  });
});
