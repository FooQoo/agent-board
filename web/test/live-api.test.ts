import type { ProxyOptions } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { liveProxy } from '../live-api';

const backendOrigin = 'http://127.0.0.1:7421';
const webOrigin = 'http://127.0.0.1:7420';

function requestHandler() {
  const on = vi.fn();
  const options = liveProxy(backendOrigin, webOrigin);
  options.configure?.(
    { on } as unknown as Parameters<NonNullable<ProxyOptions['configure']>>[0],
    options,
  );
  expect(on).toHaveBeenCalledWith('proxyReq', expect.any(Function));
  return on.mock.calls[0]?.[1] as (
    proxyReq: { setHeader: ReturnType<typeof vi.fn> },
    req: { method: string; headers: Record<string, string> },
  ) => void;
}

describe('live API write proxy', () => {
  it.each(['POST', 'DELETE', 'PUT', 'PATCH'])(
    'forwards a same-origin %s write with the backend origin',
    (method) => {
      const setHeader = vi.fn();
      requestHandler()(
        { setHeader },
        { method, headers: { origin: webOrigin, 'sec-fetch-site': 'same-origin' } },
      );
      expect(setHeader).toHaveBeenCalledExactlyOnceWith('Origin', backendOrigin);
    },
  );

  it.each([
    { method: 'GET', headers: { origin: webOrigin, 'sec-fetch-site': 'same-origin' } },
    {
      method: 'PUT',
      headers: { origin: 'http://elsewhere.test', 'sec-fetch-site': 'same-origin' },
    },
    { method: 'PATCH', headers: { origin: webOrigin, 'sec-fetch-site': 'cross-site' } },
  ])('does not rewrite an untrusted request: $method $headers', (req) => {
    const setHeader = vi.fn();
    requestHandler()({ setHeader }, req);
    expect(setHeader).not.toHaveBeenCalled();
  });
});
