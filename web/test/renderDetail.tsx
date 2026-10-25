import { render, type RenderResult } from '@testing-library/react';
import { cloneElement, useMemo, type ReactElement } from 'react';
import {
  createDetailFixtureAdapter,
  type DetailFixture,
} from '../src/features/tasks/detail/detailFixture';
import type { Epic, Task, TaskSummary } from '../src/shared/api/contracts';
import { DataProvider } from '../src/shared/data/react';

/** What a task's Detail holds, from the full task the older tests were written with. */
export function detailOf(task: Task): NonNullable<DetailFixture['tasks']>[number] {
  return {
    blocks: task.body === '' ? [] : [task.body],
    acceptance: task.acceptance,
    history: task.history,
    attachments: task.attachments,
  };
}

interface Carrier {
  task?: TaskSummary | Task | null;
  epics?: readonly Epic[];
  epic?: Epic;
}

function Detail({ ui }: { ui: ReactElement<Carrier> }) {
  const fixture = useMemo<DetailFixture>(() => ({ tasks: {}, epics: {} }), []);
  const adapter = useMemo(() => createDetailFixtureAdapter(fixture), [fixture]);
  const { task, epic } = ui.props;
  const epics = [...(ui.props.epics ?? []), ...(epic ? [epic] : [])];
  if (task && 'body' in task) (fixture.tasks as Record<number, unknown>)[task.id] = detailOf(task);
  for (const epic of epics)
    (fixture.epics as Record<string, unknown>)[epic.id] = {
      blocks: epic.body === '' ? [] : [epic.body],
      attachments: epic.attachments,
    };
  return <DataProvider adapter={adapter}>{cloneElement(ui)}</DataProvider>;
}

/**
 * Renders a screen that reads a Detail, serving the Detail of the `task` (and `epics`) it is
 * given from memory. The Detail arrives after the first render, so wait for what it holds.
 */
export function renderDetail(ui: ReactElement<Carrier>): RenderResult {
  const result = render(<Detail ui={ui} />);
  return {
    ...result,
    rerender: (next) => result.rerender(<Detail ui={next as ReactElement<Carrier>} />),
  };
}
