// Serves the Detail of a few tasks and epics from memory, for the stories and tests of the screens that read a Detail.
import type { ReactElement, ReactNode } from 'react';
import type { Attachment, Epic, Task } from '../../../shared/api/contracts';
import type { BlockKind, DetailEvent, DetailImage } from '../../../shared/data/api';
import type { DataAdapter, DetailRequest } from '../../../shared/data/core';
import { DataProvider } from '../../../shared/data/react';

export interface FixtureBlock {
  kind?: BlockKind;
  text: string;
  images?: DetailImage[];
}

export interface FixtureTaskDetail {
  /** Markdown blocks; a plain string is one block. */
  blocks?: Array<FixtureBlock | string>;
  acceptance?: Array<{ id: string; text: string; done: boolean }>;
  history?: Array<{ at: string; reason: string }>;
  attachments?: Attachment[];
}

export interface FixtureEpicDetail {
  blocks?: Array<FixtureBlock | string>;
  attachments?: Attachment[];
}

export interface DetailFixture {
  tasks?: Record<number, FixtureTaskDetail>;
  epics?: Record<string, FixtureEpicDetail>;
}

export interface FixtureOptions {
  /** Every Detail read fails, for the failure states. */
  failDetail?: boolean;
  /** A Detail stream stops after this many events and never finishes: a document still arriving. */
  stallAfter?: number;
  /** Called with every Detail request. */
  onRequest?(request: DetailRequest): void;
}

const blockOf = (
  block: FixtureBlock | string,
): Required<Pick<FixtureBlock, 'kind' | 'text'>> & FixtureBlock =>
  typeof block === 'string' ? { kind: 'markdown', text: block } : { kind: 'markdown', ...block };

function* documentEvents(
  blocks: Array<FixtureBlock | string>,
  attachments: Attachment[] | undefined,
  acceptance: NonNullable<FixtureTaskDetail['acceptance']>,
): Generator<DetailEvent> {
  yield { type: 'section-start', section: 'document' };
  if (attachments) yield { type: 'attachments', items: attachments };
  for (const block of blocks) yield { type: 'block', ...blockOf(block) };
  for (const item of acceptance) yield { type: 'acceptance', ...item };
  yield { type: 'section-end', section: 'document', count: blocks.length + acceptance.length };
}

function* events(fixture: DetailFixture, request: DetailRequest): Generator<DetailEvent> {
  const { resource, sections } = request;
  const versions = Object.fromEntries(sections.map((section) => [section, 'v1']));
  yield {
    type: 'start',
    resource: resource.kind,
    id: resource.id,
    projectId: resource.projectId,
    sections,
    versions,
  };
  if (resource.kind === 'task') {
    const task = fixture.tasks?.[resource.id] ?? {};
    for (const section of sections) {
      if (section === 'document')
        yield* documentEvents(task.blocks ?? [], task.attachments, task.acceptance ?? []);
      else {
        const items = task.history ?? [];
        yield { type: 'section-start', section: 'history' };
        for (const item of items) yield { type: 'history-item', ...item };
        yield { type: 'section-end', section: 'history', count: items.length };
      }
    }
  } else {
    const epic = fixture.epics?.[resource.id] ?? {};
    yield* documentEvents(epic.blocks ?? [], epic.attachments, []);
  }
  yield { type: 'complete', versions };
}

const never = (signal: AbortSignal) =>
  new Promise<void>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
      once: true,
    });
  });

/** An adapter that answers Detail reads from the fixture. It has no Summary and no changes. */
export function createDetailFixtureAdapter(
  fixture: DetailFixture,
  options: FixtureOptions = {},
): DataAdapter {
  return {
    fetchSummary: () => new Promise(() => {}),
    async *streamDetail(request, signal) {
      options.onRequest?.(request);
      if (options.failDetail) throw new Error('offline');
      let sent = 0;
      for (const event of events(fixture, request)) {
        yield event;
        sent += 1;
        if (options.stallAfter !== undefined && sent >= options.stallAfter) await never(signal);
      }
    },
    openEvents(handlers) {
      const open = setTimeout(() => handlers.onOpen?.(), 0);
      return () => clearTimeout(open);
    },
  };
}

/** Gives a story or a test the data layer, reading the fixture instead of a server. */
export function withDetailFixture(
  fixture: DetailFixture,
  children: ReactNode,
  options?: FixtureOptions,
): ReactElement {
  return (
    <DataProvider adapter={createDetailFixtureAdapter(fixture, options)}>{children}</DataProvider>
  );
}

/** What a task's Detail holds, from a full task. */
export function taskDetailOf(task: Task): FixtureTaskDetail {
  return {
    blocks: task.body === '' ? [] : [task.body],
    acceptance: task.acceptance,
    history: task.history,
    attachments: task.attachments,
  };
}

/** What an epic's Detail holds, from a full epic. */
export function epicDetailOf(epic: Epic): FixtureEpicDetail {
  return { blocks: epic.body === '' ? [] : [epic.body], attachments: epic.attachments };
}

/** The Detail of these tasks and epics, as the server would hold it. */
export function detailFixtureOf(
  tasks: readonly Task[],
  epics: readonly Epic[] = [],
): DetailFixture {
  return {
    tasks: Object.fromEntries(tasks.map((task) => [task.id, taskDetailOf(task)])),
    epics: Object.fromEntries(epics.map((epic) => [epic.id, epicDetailOf(epic)])),
  };
}
