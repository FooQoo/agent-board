import { describe, expect, it, vi } from 'vitest';
import type { DetailEvent } from '../api/contracts';
import { ContractError } from '../api/guards';
import { ndjsonEvents, readDetail, StreamRejected } from './stream-reader';
import { P, task, taskStream } from './test-support';

const enc = new TextEncoder();

function bytesStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

async function* events(list: DetailEvent[], failAfter?: number): AsyncGenerator<DetailEvent> {
  let n = 0;
  for (const event of list) {
    if (failAfter !== undefined && n === failAfter) throw new Error('connection lost');
    n++;
    yield event;
  }
}

const full = taskStream(
  7,
  { document: 'd1', history: 'h1' },
  { text: 'hello', reasons: ['a', 'b'] },
);
const expectation = { resource: task(7), sections: ['document', 'history'] as const };
const sections = ['document', 'history'] as ('document' | 'history')[];

const rejection = async (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (e: unknown) => e,
  );

describe('ndjsonEvents', () => {
  const text = `${full.map((e) => JSON.stringify(e)).join('\n')}\n`;

  it('reads lines that arrive in one chunk', async () => {
    expect(await collect(ndjsonEvents(bytesStream([enc.encode(text)])))).toEqual(full);
  });

  it('reads lines split at any byte, including inside a multibyte character', async () => {
    const jp = taskStream(7, { document: 'd1' }, { text: 'こんにちは、世界🙂' });
    const bytes = enc.encode(`${jp.map((e) => JSON.stringify(e)).join('\n')}\n`);
    for (const size of [1, 2, 3, 5, 7]) {
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
      expect(await collect(ndjsonEvents(bytesStream(chunks)))).toEqual(jp);
    }
  });

  it('skips empty lines and accepts CRLF and a last line without a newline', async () => {
    const lines = full.map((e) => JSON.stringify(e));
    const body = `\n${lines.slice(0, 3).join('\r\n')}\n\n${lines.slice(3).join('\n')}`;
    expect(await collect(ndjsonEvents(bytesStream([enc.encode(body)])))).toEqual(full);
  });

  it('throws a contract error for a line that is not an event', async () => {
    const stream = bytesStream([enc.encode('{"type":"start"')]);
    expect(await rejection(collect(ndjsonEvents(stream)))).toBeInstanceOf(ContractError);
  });
});

describe('readDetail', () => {
  it('returns the whole sections only after complete', async () => {
    const result = await readDetail(events(full), { ...expectation, sections });
    expect(result.versions).toEqual({ document: 'd1', history: 'h1' });
    expect(result.document).toEqual({
      blocks: [{ kind: 'markdown', text: 'hello' }],
      acceptance: [],
    });
    expect(result.history?.items.map((i) => i.reason)).toEqual(['a', 'b']);
  });

  it('keeps the attachments of the document and hands them out as partial', async () => {
    const items = [
      {
        id: 'a1',
        name: 'one.png',
        mediaType: 'image/png',
        size: 10,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];
    const withList: DetailEvent[] = [...full];
    withList.splice(2, 0, { type: 'attachments', items });
    const onPartial = vi.fn();
    const result = await readDetail(events(withList), { ...expectation, sections }, { onPartial });
    expect(result.document?.attachments).toEqual(items);
    expect(result.document?.blocks).toHaveLength(1);
    expect(onPartial.mock.calls[0]?.[1]).toMatchObject({ attachments: items });
    // A document with no such event reads as before.
    const bare = await readDetail(events(full), { ...expectation, sections });
    expect(bare.document?.attachments).toBeUndefined();
  });

  it('rejects an attachments event after a block, or a second one', async () => {
    const list: DetailEvent = { type: 'attachments', items: [] };
    const late: DetailEvent[] = [...full];
    late.splice(3, 0, list);
    const twice: DetailEvent[] = [...full];
    twice.splice(2, 0, list, list);
    for (const stream of [late, twice]) {
      const error = await rejection(readDetail(events(stream), { ...expectation, sections }));
      expect((error as StreamRejected).reason).toBe('order');
    }
  });

  it('hands out what has arrived as partial while the stream runs', async () => {
    const seen: string[] = [];
    const onPartial = vi.fn((section: string, data: unknown) => {
      seen.push(`${section}:${JSON.stringify(data).length}`);
    });
    await readDetail(events(full), { ...expectation, sections }, { onPartial });
    expect(onPartial).toHaveBeenCalledTimes(3); // one block, two history items
    expect(onPartial.mock.calls[0]?.[0]).toBe('document');
    expect(onPartial.mock.calls[2]?.[1]).toMatchObject({
      items: [{ reason: 'a' }, { reason: 'b' }],
    });
  });

  it('keeps nothing when the stream is cut before complete', async () => {
    const onPartial = vi.fn();
    const error = await rejection(
      readDetail(events(full, 5), { ...expectation, sections }, { onPartial }),
    );
    expect(error).toBeInstanceOf(StreamRejected);
    expect((error as StreamRejected).reason).toBe('transport');
    expect(onPartial).toHaveBeenCalled();
  });

  it('rejects a stream that ends without complete', async () => {
    const error = await rejection(
      readDetail(events(full.slice(0, -1)), { ...expectation, sections }),
    );
    expect((error as StreamRejected).reason).toBe('incomplete');
  });

  it('rejects events out of order', async () => {
    const swapped = [full[0], full[2], full[1], ...full.slice(3)] as DetailEvent[];
    const error = await rejection(readDetail(events(swapped), { ...expectation, sections }));
    expect((error as StreamRejected).reason).toBe('order');
  });

  it('rejects a section-end count that does not match what arrived', async () => {
    const bad = full.map((e) =>
      e.type === 'section-end' && e.section === 'history' ? { ...e, count: 5 } : e,
    );
    const error = await rejection(readDetail(events(bad), { ...expectation, sections }));
    expect((error as StreamRejected).reason).toBe('order');
  });

  it('rejects a complete whose versions differ from start', async () => {
    const bad = full.map((e) =>
      e.type === 'complete' ? { ...e, versions: { document: 'd2', history: 'h1' } } : e,
    );
    const error = await rejection(readDetail(events(bad), { ...expectation, sections }));
    expect((error as StreamRejected).reason).toBe('order');
  });

  it('rejects versions other than the ones requested, before reading on', async () => {
    const pulled = vi.fn();
    async function* spy() {
      for (const e of full) {
        pulled(e.type);
        yield e;
      }
    }
    const error = await rejection(
      readDetail(spy(), {
        ...expectation,
        sections,
        versions: { document: 'd0', history: 'h1' },
      }),
    );
    expect((error as StreamRejected).reason).toBe('version-mismatch');
    expect(pulled).toHaveBeenCalledTimes(1);
  });

  it('accepts versions equal to the requested ones', async () => {
    const result = await readDetail(events(full), {
      ...expectation,
      sections,
      versions: { document: 'd1', history: 'h1' },
    });
    expect(result.versions.document).toBe('d1');
  });

  it('rejects a stream about another resource or other sections', async () => {
    const other = taskStream(8, { document: 'd1', history: 'h1' });
    expect(
      ((await rejection(readDetail(events(other), { ...expectation, sections }))) as StreamRejected)
        .reason,
    ).toBe('identity');
    const otherProject = taskStream(7, { document: 'd1', history: 'h1' }, { projectId: 'zz' });
    expect(
      (
        (await rejection(
          readDetail(events(otherProject), { ...expectation, sections }),
        )) as StreamRejected
      ).reason,
    ).toBe('identity');
    const onlyDoc = taskStream(7, { document: 'd1' });
    expect(
      (
        (await rejection(
          readDetail(events(onlyDoc), { ...expectation, sections }),
        )) as StreamRejected
      ).reason,
    ).toBe('identity');
    expect(P).toBe('p1');
  });

  it('stops with aborted when the signal fires', async () => {
    const controller = new AbortController();
    async function* slow() {
      yield full[0] as DetailEvent;
      controller.abort();
      yield full[1] as DetailEvent;
    }
    const error = await rejection(
      readDetail(slow(), { ...expectation, sections }, { signal: controller.signal }),
    );
    expect((error as StreamRejected).reason).toBe('aborted');
  });
});
