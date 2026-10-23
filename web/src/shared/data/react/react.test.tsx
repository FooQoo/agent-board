import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changed, FakeAdapter, P, summaryOf, task, taskStream } from '../core/test-support';
import type { VisibilitySource } from '../core/event-connection';
import { DataProvider, useDataCore } from './provider';
import { useEpicDetail } from './use-epic-detail';
import { usePresentationHold } from './use-presentation-hold';
import { useSummary } from './use-summary';
import { useTaskDetail } from './use-task-detail';

let adapter: FakeAdapter;
const visible: VisibilitySource = { hidden: () => false, subscribe: () => () => {} };

beforeEach(() => {
  vi.useFakeTimers();
  adapter = new FakeAdapter();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const tick = (ms = 0) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function wrap(children: React.ReactNode, strict = false) {
  const tree = (
    <DataProvider adapter={adapter} visibility={visible}>
      {children}
    </DataProvider>
  );
  return strict ? <StrictMode>{tree}</StrictMode> : tree;
}

function SummaryView({ project }: { project: string | null }) {
  const { state, summary } = useSummary(project);
  return (
    <p data-testid="summary">
      {state}:{summary?.version ?? '-'}
    </p>
  );
}

function TaskView({ id, sections }: { id: number | null; sections?: ('document' | 'history')[] }) {
  const { document, history } = useTaskDetail(P, id, sections);
  return (
    <p data-testid="task">
      {document.state}:{document.data?.blocks[0]?.text ?? '-'}|{history.state}
    </p>
  );
}

describe('provider', () => {
  it('opens the connection on mount and closes it on unmount', async () => {
    const view = render(wrap(<p>x</p>));
    await tick();
    expect(adapter.opened).toBe(1);
    view.unmount();
    expect(adapter.closed).toBe(1);
  });

  it('survives the double mount of strict mode', async () => {
    render(wrap(<SummaryView project={P} />, true));
    await tick();
    act(() => adapter.handlers?.onOpen?.());
    expect(adapter.summaryCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('refuses hooks outside of it', () => {
    function Bare() {
      useDataCore();
      return null;
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Bare />)).toThrow(/DataProvider/);
    error.mockRestore();
  });
});

describe('useSummary', () => {
  it('shows the Summary once the subscription is open and the fetch is done', async () => {
    render(wrap(<SummaryView project={P} />));
    await tick();
    expect(screen.getByTestId('summary').textContent).toBe('absent:-');
    expect(adapter.summaryCalls).toHaveLength(0);
    act(() => adapter.handlers?.onOpen?.());
    expect(screen.getByTestId('summary').textContent).toBe('loading:-');
    await act(async () => {
      adapter.summaryCalls[0]?.resolve(summaryOf([], 'sv9'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('summary').textContent).toBe('ready:sv9');
  });

  it('fetches nothing for no project', async () => {
    render(wrap(<SummaryView project={null} />));
    await tick();
    act(() => adapter.handlers?.onOpen?.());
    expect(adapter.summaryCalls).toHaveLength(0);
  });

  it('follows a notification into the screen', async () => {
    render(wrap(<SummaryView project={P} />));
    await tick();
    act(() => adapter.handlers?.onOpen?.());
    await act(async () => {
      adapter.summaryCalls[0]?.resolve(summaryOf([], 'sv1'));
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() =>
      adapter.handlers?.onChanged(
        changed(1, [{ resource: 'project', id: P, facets: ['summary'] }]),
      ),
    );
    await tick(150);
    await act(async () => {
      adapter.summaryCalls[1]?.resolve(summaryOf([], 'sv2'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('summary').textContent).toBe('ready:sv2');
  });
});

describe('useTaskDetail', () => {
  it('loads the sections it is asked for, pins them, and unpins on unmount', async () => {
    const view = render(wrap(<TaskView id={4} />));
    await tick();
    expect(adapter.streamCalls.map((c) => c.request.sections)).toEqual([['document', 'history']]);
    const core = adapter.streamCalls[0];
    await act(async () => {
      core?.respond(taskStream(4, { document: 'd1', history: 'h1' }, { text: 'hello' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('task').textContent).toBe('ready:hello|ready');
    view.unmount();
  });

  it('asks only for the sections it needs', async () => {
    render(wrap(<TaskView id={4} sections={['history']} />));
    await tick();
    expect(adapter.streamCalls.map((c) => c.request.sections)).toEqual([['history']]);
  });

  it('shows what has arrived while the stream runs, and the whole version after', async () => {
    render(wrap(<TaskView id={4} sections={['document']} />));
    await tick();
    const stream = taskStream(4, { document: 'd1' }, { text: 'hello' });
    await act(async () => {
      adapter.streamCalls[0]?.push(...stream.slice(0, 3));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('task').textContent).toBe('loading:-|absent');
  });

  it('does nothing for no task', async () => {
    render(wrap(<TaskView id={null} />));
    await tick();
    expect(adapter.streamCalls).toHaveLength(0);
  });

  it('pins while mounted', async () => {
    let seen: ReturnType<typeof useDataCore> | null = null;
    function Probe() {
      seen = useDataCore();
      return <TaskView id={4} sections={['document']} />;
    }
    const view = render(wrap(<Probe />));
    await tick();
    expect(seen !== null && (seen as ReturnType<typeof useDataCore>).store.isPinned(task(4))).toBe(
      true,
    );
    view.unmount();
    expect(seen !== null && (seen as ReturnType<typeof useDataCore>).store.isPinned(task(4))).toBe(
      false,
    );
  });
});

describe('useEpicDetail', () => {
  it('loads the document of an epic', async () => {
    function EpicView() {
      const { document } = useEpicDetail(P, 'E');
      return <p data-testid="epic">{document.state}</p>;
    }
    render(wrap(<EpicView />));
    await tick();
    expect(adapter.streamCalls.map((c) => [c.request.resource.kind, c.request.sections])).toEqual([
      ['epic', ['document']],
    ]);
  });
});

describe('usePresentationHold', () => {
  function Holder({ open }: { open: boolean }) {
    usePresentationHold(open);
    const core = useDataCore();
    return <p data-testid="blocked">{String(core.gate.blocked)}</p>;
  }

  it('holds while open and for 3 seconds after it closes', async () => {
    const view = render(wrap(<Holder open={false} />));
    await tick();
    expect(screen.getByTestId('blocked').textContent).toBe('false');
    view.rerender(wrap(<Holder open={true} />));
    await tick();
    view.rerender(wrap(<Holder open={true} />));
    expect(screen.getByTestId('blocked').textContent).toBe('true');
    view.rerender(wrap(<Holder open={false} />));
    await tick(2_999);
    view.rerender(wrap(<Holder open={false} />));
    expect(screen.getByTestId('blocked').textContent).toBe('true');
    await tick(1);
    view.rerender(wrap(<Holder open={false} />));
    expect(screen.getByTestId('blocked').textContent).toBe('false');
  });

  it('opening again cancels the timer', async () => {
    const view = render(wrap(<Holder open={true} />));
    await tick();
    view.rerender(wrap(<Holder open={false} />));
    await tick(2_000);
    view.rerender(wrap(<Holder open={true} />));
    await tick(10_000);
    view.rerender(wrap(<Holder open={true} />));
    expect(screen.getByTestId('blocked').textContent).toBe('true');
  });
});
