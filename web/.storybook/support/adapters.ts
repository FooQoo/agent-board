// Fakes for the product's write and read contracts. Each Story or test creates its own instances, so
// calls and pending results never carry over. They implement the product's types and never import the
// production API modules; the monitor's URL shapes come from the product's own unconnected resolvers.

import type {
  AnswerInput,
  AnswerResult,
  AnswerWriter,
} from '../../src/features/tasks/answer/model/answer';
import type { EpicApi } from '../../src/features/epics/editor/EpicDialog';
import type { Epic, EpicRef, ProjectId } from '../../src/shared/api/contracts';
import {
  type MonitorReadResolvers,
  unconnectedMonitorReadResolvers,
} from '../../src/pages/monitor/contracts';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

/** A promise a Story or test settles by hand, to show a saving or failed state for as long as needed. */
export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A recorder of calls, with the arguments of each call in order. Arguments are copied when recorded. */
export interface CallLog<Args extends unknown[]> {
  calls: Args[];
  record(...args: Args): void;
}

export function createCallLog<Args extends unknown[]>(): CallLog<Args> {
  const calls: Args[] = [];
  return {
    calls,
    record: (...args: Args) => {
      // A later change to the caller's objects must not change what was recorded.
      calls.push(args.map((arg) => copyArgument(arg)) as Args);
    },
  };
}

/** A structured copy where the value allows one; a value that cannot be copied is kept as it is. */
function copyArgument<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

export interface FakeAnswerWriter {
  writer: AnswerWriter;
  calls: CallLog<[projectId: ProjectId, taskId: number, input: AnswerInput]>;
}

/** An answer writer whose every call is decided by `respond`, which the Story or test controls. */
export function createFakeAnswerWriter(
  respond: (input: AnswerInput) => Promise<AnswerResult>,
): FakeAnswerWriter {
  const calls = createCallLog<[projectId: ProjectId, taskId: number, input: AnswerInput]>();
  const writer: AnswerWriter = (projectId, taskId, input) => {
    calls.record(projectId, taskId, input);
    return respond(input);
  };
  return { writer, calls };
}

export type EpicApiMethod = keyof EpicApi;

export interface FakeEpicApi {
  api: EpicApi;
  /** Every call in order, as `[method, ...arguments]`. A call is recorded even when it fails. */
  calls: CallLog<[method: EpicApiMethod, ...args: unknown[]]>;
}

/**
 * An epic API in which each write is recorded under its method name and then decided by `respond`.
 * The product saves an epic in stages, so `respond` can resolve one stage and reject the next.
 */
export function createFakeEpicApi(respond: (method: EpicApiMethod) => Promise<void>): FakeEpicApi {
  const calls = createCallLog<[method: EpicApiMethod, ...args: unknown[]]>();
  const write =
    (method: EpicApiMethod) =>
    (...args: unknown[]) => {
      calls.record(method, ...args);
      return respond(method);
    };
  const api: EpicApi = {
    addImages: (files, requestId) => write('addImages')(files, requestId),
    removeImage: (attachmentId) => write('removeImage')(attachmentId),
    savePlan: (input) => write('savePlan')(input),
    saveDetails: (details) => write('saveDetails')(details),
    savePriority: (priority) => write('savePriority')(priority),
    remove: () => write('remove')(),
  };
  return { api, calls };
}

export interface FakeMonitorReadResolvers {
  resolvers: MonitorReadResolvers;
  /** The project IDs passed to `getEpics`, in order. */
  epicRequests: CallLog<[projectId: ProjectId]>;
}

/**
 * Read resolvers for a monitor Story. The URL builders are the product's own unconnected ones, so a
 * Story shows the real URL shapes. `getEpics` answers from `epicsByProject`: an unknown project fails
 * as the product does, and an aborted signal rejects before an answer is given.
 */
export function createFakeMonitorReadResolvers(
  epicsByProject: Record<ProjectId, Epic[]> = {},
): FakeMonitorReadResolvers {
  const epicRequests = createCallLog<[projectId: ProjectId]>();
  const resolvers: MonitorReadResolvers = {
    ...unconnectedMonitorReadResolvers,
    getEpics: async (projectId, signal) => {
      epicRequests.record(projectId);
      if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
      const epics = epicsByProject[projectId];
      if (!epics) throw new Error(`No epics are stored for project ${projectId}.`);
      return copyArgument(epics);
    },
  };
  return { resolvers, epicRequests };
}

/** The reference of an epic as a card shows it: a new object, so the card cannot change the epic. */
export function epicRefOf(epic: Epic): EpicRef {
  return { id: epic.id, name: epic.name, color: epic.color };
}
