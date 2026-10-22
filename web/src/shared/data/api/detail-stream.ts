// Parsing and order checks for a Detail NDJSON stream. A caller feeds each line to
// `parseDetailLine` and the result to a `DetailStreamValidator`; blocks are held aside until
// `complete` has been accepted and `finish()` has passed.
import type {
  DetailAttachment,
  DetailEvent,
  DetailImage,
  DetailResource,
  DetailSection,
  DetailVersions,
} from './contracts';
import { bool, exact, fail, int, list, oneOf, str } from './guards';

const SECTIONS = ['document', 'history'] as const;
const RESOURCES = ['task', 'epic'] as const;
const KINDS = ['markdown', 'mermaid'] as const;

function versions(value: unknown, path: string): DetailVersions {
  const o = exact(value, path, [], ['document', 'history']);
  const out: DetailVersions = {};
  if (o.document !== undefined) out.document = str(o.document, `${path}.document`);
  if (o.history !== undefined) out.history = str(o.history, `${path}.history`);
  return out;
}

function image(value: unknown, path: string): DetailImage {
  const o = exact(value, path, ['src'], ['width', 'height']);
  const out: DetailImage = { src: str(o.src, `${path}.src`) };
  if (o.width !== undefined) out.width = int(o.width, `${path}.width`, 1);
  if (o.height !== undefined) out.height = int(o.height, `${path}.height`, 1);
  return out;
}

function attachment(value: unknown, path: string): DetailAttachment {
  const o = exact(value, path, ['id', 'name', 'mediaType', 'size', 'createdAt']);
  return {
    id: str(o.id, `${path}.id`),
    name: str(o.name, `${path}.name`),
    mediaType: str(o.mediaType, `${path}.mediaType`),
    size: int(o.size, `${path}.size`),
    createdAt: str(o.createdAt, `${path}.createdAt`),
  };
}

/** One NDJSON line as an event, or a `ContractError` (bad JSON, unknown `type`, bad shape). */
export function parseDetailLine(line: string): DetailEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return fail('line', 'JSON');
  }
  const type = (value as { type?: unknown } | null)?.type;
  switch (type) {
    case 'start': {
      const o = exact(value, 'start', [
        'type',
        'resource',
        'id',
        'projectId',
        'sections',
        'versions',
      ]);
      const resource = oneOf(o.resource, 'start.resource', RESOURCES);
      return {
        type,
        resource,
        id: resource === 'task' ? int(o.id, 'start.id', 1) : str(o.id, 'start.id'),
        projectId: str(o.projectId, 'start.projectId'),
        sections: list(o.sections, 'start.sections', (v, p) => oneOf(v, p, SECTIONS)),
        versions: versions(o.versions, 'start.versions'),
      };
    }
    case 'section-start': {
      const o = exact(value, 'section-start', ['type', 'section']);
      return { type, section: oneOf(o.section, 'section-start.section', SECTIONS) };
    }
    case 'attachments': {
      const o = exact(value, 'attachments', ['type', 'items']);
      return { type, items: list(o.items, 'attachments.items', attachment) };
    }
    case 'block': {
      const o = exact(value, 'block', ['type', 'kind', 'text'], ['images']);
      const event: DetailEvent = {
        type,
        kind: oneOf(o.kind, 'block.kind', KINDS),
        text: str(o.text, 'block.text'),
      };
      if (o.images !== undefined) event.images = list(o.images, 'block.images', image);
      return event;
    }
    case 'acceptance': {
      const o = exact(value, 'acceptance', ['type', 'id', 'text', 'done']);
      return {
        type,
        id: str(o.id, 'acceptance.id'),
        text: str(o.text, 'acceptance.text'),
        done: bool(o.done, 'acceptance.done'),
      };
    }
    case 'history-item': {
      const o = exact(value, 'history-item', ['type', 'at', 'reason']);
      return {
        type,
        at: str(o.at, 'history-item.at'),
        reason: str(o.reason, 'history-item.reason'),
      };
    }
    case 'section-end': {
      const o = exact(value, 'section-end', ['type', 'section', 'count']);
      return {
        type,
        section: oneOf(o.section, 'section-end.section', SECTIONS),
        count: int(o.count, 'section-end.count'),
      };
    }
    case 'complete': {
      const o = exact(value, 'complete', ['type', 'versions']);
      return { type, versions: versions(o.versions, 'complete.versions') };
    }
    default:
      return fail(
        'type',
        'start, section-start, attachments, block, acceptance, history-item, section-end or complete',
      );
  }
}

type State =
  | { at: 'init' }
  | { at: 'between'; next: number }
  | { at: 'section'; index: number; count: number; acceptance: boolean; attachments: boolean }
  | { at: 'done' };

function sameVersions(a: DetailVersions, b: DetailVersions): boolean {
  return a.document === b.document && a.history === b.history;
}

/** Checks the order of a Detail stream: feed events with `accept`, then call `finish`. */
export class DetailStreamValidator {
  private state: State = { at: 'init' };
  private resource: DetailResource = 'task';
  private sections: DetailSection[] = [];
  private versions: DetailVersions = {};

  accept(event: DetailEvent): void {
    const state = this.state;
    if (state.at === 'init') {
      if (event.type !== 'start') fail('stream', 'start first');
      this.start(event);
    } else if (state.at === 'done') {
      fail('stream', 'nothing after complete');
    } else if (state.at === 'between') {
      this.between(event, state.next);
    } else {
      this.inSection(event, state);
    }
  }

  /** The stream is whole only if `complete` arrived. */
  finish(): void {
    if (this.state.at !== 'done') fail('stream', 'complete before the stream ends');
  }

  private start(event: Extract<DetailEvent, { type: 'start' }>): void {
    const fits =
      event.resource === 'task' ? typeof event.id === 'number' : typeof event.id === 'string';
    if (!fits) fail('start.id', 'an ID that fits the resource');
    const allowed =
      event.resource === 'task' ? ['document', 'history', 'document,history'] : ['document'];
    if (!allowed.includes(event.sections.join(','))) {
      fail('start.sections', 'document and/or history, in that order, as the resource has');
    }
    const has = (s: DetailSection) => event.sections.includes(s);
    if (
      (event.versions.document !== undefined) !== has('document') ||
      (event.versions.history !== undefined) !== has('history')
    ) {
      fail('start.versions', 'exactly the requested sections');
    }
    this.resource = event.resource;
    this.sections = event.sections;
    this.versions = event.versions;
    this.state = { at: 'between', next: 0 };
  }

  private between(event: DetailEvent, next: number): void {
    if (event.type === 'section-start') {
      if (this.sections[next] !== event.section)
        fail('section-start', 'the next requested section');
      this.state = {
        at: 'section',
        index: next,
        count: 0,
        acceptance: false,
        attachments: false,
      };
    } else if (event.type === 'complete') {
      if (next !== this.sections.length) fail('complete', 'every requested section ended first');
      if (!sameVersions(event.versions, this.versions))
        fail('complete.versions', 'the versions of start');
      this.state = { at: 'done' };
    } else {
      fail(event.type, 'section-start or complete here');
    }
  }

  private inSection(event: DetailEvent, state: Extract<State, { at: 'section' }>): void {
    const section = this.sections[state.index];
    if (event.type === 'section-end') {
      if (event.section !== section) fail('section-end.section', `${section}`);
      if (event.count !== state.count) fail('section-end.count', `${state.count}`);
      this.state = { at: 'between', next: state.index + 1 };
    } else if (section === 'document' && event.type === 'attachments') {
      if (state.attachments) fail('attachments', 'one attachments event in the document');
      if (state.count > 0) fail('attachments', 'attachments before the first block');
      // The list is the document's header, not an item: the count stays.
      this.state = { ...state, attachments: true };
    } else if (section === 'document' && event.type === 'block') {
      if (state.acceptance) fail('block', 'no block after an acceptance condition');
      this.state = { ...state, count: state.count + 1 };
    } else if (section === 'document' && event.type === 'acceptance' && this.resource === 'task') {
      this.state = { ...state, count: state.count + 1, acceptance: true };
    } else if (section === 'history' && event.type === 'history-item') {
      this.state = { ...state, count: state.count + 1 };
    } else {
      fail(event.type, `an event that belongs in the ${section} section`);
    }
  }
}

/** A whole NDJSON text as its events, in order, or a `ContractError`. */
export function readDetailStream(text: string): DetailEvent[] {
  const validator = new DetailStreamValidator();
  const events: DetailEvent[] = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const event = parseDetailLine(line);
    validator.accept(event);
    events.push(event);
  }
  validator.finish();
  return events;
}
