// Fakes for the product's write and read contracts. Each Story creates its own instances, so calls
// and pending results never carry over to another Story. They implement the product's types and
// never import the production API modules.

import type { Epic, EpicRef } from '../../src/shared/api/contracts';
import type {
  AnswerInput,
  AnswerResult,
  AnswerWriter,
} from '../../src/features/tasks/answer/model/answer';
import type { EpicApi } from '../../src/features/epics/editor/EpicDialog';
import type { MonitorReadResolvers } from '../../src/pages/monitor/contracts';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

/** A promise a Story settles by hand, to show a saving or failed state for as long as it needs. */
export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A recorder of calls, with the arguments of each call in order. */
export interface CallLog<Args extends unknown[]> {
  calls: Args[];
  record(...args: Args): void;
}

export function createCallLog<Args extends unknown[]>(): CallLog<Args> {
  const calls: Args[] = [];
  return {
    calls,
    record: (...args: Args) => {
      calls.push(args);
    },
  };
}

export interface FakeAnswerWriter {
  writer: AnswerWriter;
  calls: CallLog<[projectId: string, taskId: number, input: AnswerInput]>;
}

/** An answer writer whose every call waits on `respond`, which the Story decides per call. */
export function createFakeAnswerWriter(
  respond: (input: AnswerInput) => Promise<AnswerResult>,
): FakeAnswerWriter {
  const calls = createCallLog<[projectId: string, taskId: number, input: AnswerInput]>();
  const writer: AnswerWriter = (projectId, taskId, input) => {
    calls.record(projectId, taskId, input);
    return respond(input);
  };
  return { writer, calls };
}

export interface FakeEpicApi {
  api: EpicApi;
  calls: CallLog<[method: keyof EpicApi, ...args: unknown[]]>;
}

/** An epic API in which every write calls `respond` and is recorded under its method name. */
export function createFakeEpicApi(respond: (method: keyof EpicApi) => Promise<void>): FakeEpicApi {
  const calls = createCallLog<[method: keyof EpicApi, ...args: unknown[]]>();
  const write =
    (method: keyof EpicApi) =>
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

/** Read resolvers with the product's URL shapes and the given epics; no request is made. */
export function createFakeMonitorReadResolvers(epics: Epic[] = []): MonitorReadResolvers {
  const base = '/monitor/api/projects';
  return {
    attachmentUrl: (projectId, taskId, attachmentId) =>
      `${base}/${encodeURIComponent(projectId)}/tasks/${taskId}/attachments/${encodeURIComponent(attachmentId)}`,
    evidenceUrl: (projectId, taskId, evidenceId) =>
      `${base}/${encodeURIComponent(projectId)}/tasks/${taskId}/evidence/${encodeURIComponent(evidenceId)}`,
    epicAttachmentUrl: (projectId, epicId, attachmentId) =>
      `${base}/${encodeURIComponent(projectId)}/epics/${encodeURIComponent(epicId)}/attachments/${encodeURIComponent(attachmentId)}`,
    getEpics: async () => structuredClone(epics),
  };
}

/** The reference of an epic as a card shows it. */
export function epicRefOf(epic: Epic): EpicRef {
  return { id: epic.id, name: epic.name, color: epic.color };
}
