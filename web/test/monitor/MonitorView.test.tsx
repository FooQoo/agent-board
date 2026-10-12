import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../../src/i18n';
import { MonitorView } from '../../src/monitor/View';
import type { MonitorCard, MonitorFreshness, MonitorViewProps } from '../../src/monitor/contracts';
import { PROJECT_A, makeCard } from '../fixtures';
import { useMonitorInteractions } from '../../src/monitor/hooks/useMonitorInteractions';

beforeEach(() => selectLocale('en'));

const freshness: MonitorFreshness = {
  state: 'fresh',
  lastFetchedAt: '2026-10-12T00:00:00Z',
  failedProjectIds: [],
  snapshotProblems: [],
};

function item(card: MonitorCard['card']): MonitorCard {
  return { projectId: PROJECT_A.id, projectName: PROJECT_A.name, card };
}

function props(overrides: Partial<MonitorViewProps> = {}): MonitorViewProps {
  return {
    projects: [PROJECT_A],
    scope: 'all',
    summary: { todo: 1, doing: 2, done: 1 },
    todo: [
      item(
        makeCard({
          id: 1,
          title: 'Todo decision',
          cardStatus: 'todo',
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
        makeCard({
          id: 2,
          title: 'Doing running',
          cardStatus: 'doing',
          agentStatus: 'running',
        }),
      ),
      item(
        makeCard({
          id: 4,
          title: 'Doing decision',
          cardStatus: 'doing',
          agentStatus: 'pending',
          pendingReason: 'Should the implementation use the shared form?',
          pendingRequestId: 'request-4',
          pendingChoices: [{ id: 'shared', label: 'Use the shared form' }],
        }),
      ),
    ],
    done: [item(makeCard({ id: 3, title: 'Done', cardStatus: 'done' }))],
    freshness,
    onScopeChange: () => undefined,
    onRefresh: () => undefined,
    ...overrides,
  };
}

describe('mobile monitor lanes and card actions', () => {
  it('counts cards once by cardStatus and keeps run state inline', () => {
    render(<MonitorView {...props()} />);

    expect(screen.getByRole('button', { name: '1Todo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2Doing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '1Done' })).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getAllByRole('heading', { name: /^(Todo 1|Doing 2|Done 1)$/ })).toHaveLength(3);
    expect(screen.queryByRole('heading', { name: /Pending|Running/ })).toBeNull();
    expect(screen.getAllByText('Pending')).toHaveLength(2);
    expect(screen.getByText('Should the implementation use the shared form?')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
  });

  it('renders a disabled shared answer form for a Todo decision without opening a detail action', async () => {
    render(<MonitorView {...props()} />);

    const title = screen.getByRole('button', { name: 'Todo decision' }) as HTMLButtonElement;
    expect(title.disabled).toBe(true);
    expect(screen.getByText('Should the draft include both approaches?')).toBeTruthy();
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Send' })).toHaveLength(2);
    expect(
      screen.getAllByRole('textbox').every((input) => (input as HTMLTextAreaElement).disabled),
    ).toBe(true);
    expect(
      screen
        .getAllByRole('button', { name: 'Send' })
        .every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
    await userEvent.click(title);
    expect(screen.getByRole('button', { name: 'Todo decision' })).toBeTruthy();
  });

  it('reports title and epic-label actions as distinct drawer tabs', async () => {
    const onOpenDetail = vi.fn();
    const target = item(
      makeCard({
        id: 4,
        title: 'Linked card',
        epic: { id: 'MOB-1', name: 'Mobile interaction', color: '#4466aa' },
      }),
    );
    const user = userEvent.setup();
    render(<MonitorView {...props({ todo: [target], doing: [], done: [], onOpenDetail })} />);

    await user.click(screen.getByRole('button', { name: 'Linked card' }));
    expect(onOpenDetail).toHaveBeenLastCalledWith(target, 'description');
    await user.click(screen.getByRole('button', { name: 'MOB-1' }));
    expect(onOpenDetail).toHaveBeenLastCalledWith(target, 'epic');
    expect(onOpenDetail).toHaveBeenCalledTimes(2);
  });
});

describe('monitor answer interactions', () => {
  it('answers Todo and Doing cards through the shared form and prevents resubmission from the old snapshot', async () => {
    const writeAnswer = vi.fn(async (_projectId, cardId: number) => ({
      card: makeCard({
        id: cardId,
        cardStatus: cardId === 1 ? 'todo' : 'doing',
        agentStatus: 'idle',
        pendingRequestId: null,
      }),
      changed: true,
    }));
    function Connected() {
      const answerController = useMonitorInteractions({ writeAnswer });
      return (
        <MonitorView
          {...props()}
          answerController={answerController}
          scopeLocked={answerController.locked}
        />
      );
    }
    const user = userEvent.setup();
    render(<Connected />);
    const todo = screen.getByRole('article', { name: /Todo decision/ });
    const doing = screen.getByRole('article', { name: /Doing decision/ });

    await user.type(within(todo).getByRole('textbox'), 'Keep both approaches');
    expect(
      (screen.getByRole('button', { name: 'All Projects' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(within(todo).getByRole('button', { name: 'Send' }));
    await user.type(within(doing).getByRole('textbox'), 'Use the shared implementation');
    await user.click(within(doing).getByRole('button', { name: 'Send' }));

    expect(writeAnswer).toHaveBeenNthCalledWith(1, PROJECT_A.id, 1, {
      requestId: 'request-1',
      text: 'Keep both approaches',
    });
    expect(writeAnswer).toHaveBeenNthCalledWith(2, PROJECT_A.id, 4, {
      requestId: 'request-4',
      text: 'Use the shared implementation',
    });
    expect((within(todo).getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (within(doing).getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('monitor answer retry and retained drafts', () => {
  it('keeps the text after a failed save and sends it again when Retry is chosen', async () => {
    const writeAnswer = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        card: makeCard({ id: 1, cardStatus: 'todo', agentStatus: 'idle', pendingRequestId: null }),
        changed: true,
      });
    function Connected() {
      const answerController = useMonitorInteractions({ writeAnswer });
      return (
        <MonitorView
          {...props()}
          answerController={answerController}
          scopeLocked={answerController.locked}
        />
      );
    }
    const user = userEvent.setup();
    render(<Connected />);
    const todo = screen.getByRole('article', { name: /Todo decision/ });
    const textarea = within(todo).getByRole('textbox') as HTMLTextAreaElement;
    await user.type(textarea, 'Keep my response');
    await user.click(within(todo).getByRole('button', { name: 'Send' }));
    expect(textarea.value).toBe('Keep my response');
    expect(within(todo).getByRole('button', { name: 'Retry' })).toBeTruthy();
    await user.click(within(todo).getByRole('button', { name: 'Retry' }));
    expect(writeAnswer).toHaveBeenCalledTimes(2);
    expect(writeAnswer).toHaveBeenLastCalledWith(PROJECT_A.id, 1, {
      requestId: 'request-1',
      text: 'Keep my response',
    });
  });
});
