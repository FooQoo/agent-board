// Reads a Detail stream and checks it. Nothing leaves this module as a whole version until
// `complete` has arrived and every check has passed; what arrives before that is only `partial`.
import type { DetailEvent, DetailSection, DetailVersions } from '../api/contracts';
import { ContractError } from '../api/guards';
import { DetailStreamValidator, parseDetailLine } from '../api/detail-stream';
import type { DocumentData, HistoryData, ResourceKey, SectionDataMap } from './types';

export type RejectReason =
  | 'aborted'
  | 'transport'
  | 'incomplete'
  | 'order'
  | 'identity'
  | 'version-mismatch';

/** A stream that must not be kept: the cache holds on to its earlier whole version. */
export class StreamRejected extends Error {
  readonly reason: RejectReason;
  constructor(reason: RejectReason, detail: string, cause?: unknown) {
    super(`${reason}: ${detail}`, cause === undefined ? undefined : { cause });
    this.name = 'StreamRejected';
    this.reason = reason;
  }
}

/** The lines of an NDJSON byte stream as events; empty lines are skipped. */
export async function* ndjsonEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<DetailEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const lineEvent = (raw: string): DetailEvent | null => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    return line.trim() === '' ? null : parseDetailLine(line);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const event = lineEvent(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (event) yield event;
        newline = buffer.indexOf('\n');
      }
      if (done) break;
    }
    const last = lineEvent(buffer);
    if (last) yield last;
  } finally {
    reader.cancel().catch(() => {});
  }
}

export interface DetailExpectation {
  resource: ResourceKey;
  sections: DetailSection[];
  /** The versions the Summary named; a stream with other versions is not kept. */
  versions?: DetailVersions;
}

export interface DetailResult {
  versions: DetailVersions;
  document?: DocumentData;
  history?: HistoryData;
}

export interface ReadOptions {
  signal?: AbortSignal;
  /** What the running stream has received of one section so far. */
  onPartial?<S extends DetailSection>(section: S, data: SectionDataMap[S]): void;
}

/**
 * Reads the events of one Detail stream. Resolves only for a stream that is in order, whole
 * (`complete` arrived, `section-end.count` matches) and about what was requested; any other
 * stream rejects with `StreamRejected` and leaves no result.
 */
export async function readDetail(
  events: AsyncIterable<DetailEvent>,
  expectation: DetailExpectation,
  options: ReadOptions = {},
): Promise<DetailResult> {
  const validator = new DetailStreamValidator();
  const document: DocumentData = { blocks: [], acceptance: [] };
  const history: HistoryData = { items: [] };
  let complete: DetailVersions | null = null;

  const checkStart = (event: Extract<DetailEvent, { type: 'start' }>) => {
    const { resource } = expectation;
    if (
      event.resource !== resource.kind ||
      event.id !== resource.id ||
      event.projectId !== resource.projectId
    ) {
      throw new StreamRejected('identity', `${event.resource} ${event.id} of ${event.projectId}`);
    }
    if (event.sections.join(',') !== expectation.sections.join(',')) {
      throw new StreamRejected('identity', `sections ${event.sections.join(',')}`);
    }
    for (const name of expectation.sections) {
      const wanted = expectation.versions?.[name];
      if (wanted !== undefined && event.versions[name] !== wanted) {
        throw new StreamRejected('version-mismatch', `${name} is not the requested version`);
      }
    }
  };

  try {
    for await (const event of events) {
      if (options.signal?.aborted) throw new StreamRejected('aborted', 'the request was aborted');
      try {
        validator.accept(event);
      } catch (error) {
        if (error instanceof ContractError) throw new StreamRejected('order', error.message, error);
        throw error;
      }
      switch (event.type) {
        case 'start':
          checkStart(event);
          break;
        case 'block':
          document.blocks.push({
            kind: event.kind,
            text: event.text,
            ...(event.images ? { images: event.images } : {}),
          });
          options.onPartial?.('document', copyDocument(document));
          break;
        case 'acceptance':
          document.acceptance.push({ id: event.id, text: event.text, done: event.done });
          options.onPartial?.('document', copyDocument(document));
          break;
        case 'history-item':
          history.items.push({ at: event.at, reason: event.reason });
          options.onPartial?.('history', { items: [...history.items] });
          break;
        case 'complete':
          complete = event.versions;
          break;
      }
    }
  } catch (error) {
    if (error instanceof StreamRejected) throw error;
    if (options.signal?.aborted)
      throw new StreamRejected('aborted', 'the request was aborted', error);
    throw new StreamRejected(
      'transport',
      error instanceof Error ? error.message : String(error),
      error,
    );
  }
  if (options.signal?.aborted) throw new StreamRejected('aborted', 'the request was aborted');
  try {
    validator.finish();
  } catch {
    throw new StreamRejected('incomplete', 'the stream ended before complete');
  }
  if (complete === null) throw new StreamRejected('incomplete', 'the stream ended before complete');
  const result: DetailResult = { versions: complete };
  if (expectation.sections.includes('document')) result.document = document;
  if (expectation.sections.includes('history')) result.history = history;
  return result;
}

function copyDocument(data: DocumentData): DocumentData {
  return { blocks: [...data.blocks], acceptance: [...data.acceptance] };
}
