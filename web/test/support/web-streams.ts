// The jsdom window of a VM context has none of Node's web-stream classes, and MSW's event stream
// (`sse`) builds its response from them. This file copies them from Node. It is imported first by
// `test/setup.ts`, ahead of any module that loads MSW.
import * as streams from 'node:stream/web';

const names = [
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'TextEncoderStream',
  'TextDecoderStream',
] as const;

for (const name of names) {
  if (typeof (globalThis as Record<string, unknown>)[name] === 'undefined') {
    Object.defineProperty(globalThis, name, {
      value: streams[name],
      configurable: true,
      writable: true,
    });
  }
}
