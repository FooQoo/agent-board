// Stories must not reach the product's HTTP API or its live event stream. This guard runs in the
// Storybook preview and in the browser tests: a request to a product API path fails, and the attempt
// is recorded so that the test which made it can fail too.

const PRODUCT_API_PATHS = ['/api', '/monitor/api'];

/** Requests to product API paths made while the guard was installed, as `METHOD url` strings. */
export const blockedRequests: string[] = [];

const GUARD_FLAG = '__agboardStoryNetworkGuard';

function isProductApi(url: string): boolean {
  const { pathname } = new URL(url, window.location.href);
  return PRODUCT_API_PATHS.some((base) => pathname === base || pathname.startsWith(`${base}/`));
}

/** Records the attempt and returns the error that refuses it. */
function refuse(method: string, url: string): Error {
  blockedRequests.push(`${method} ${url}`);
  return new Error(`Story attempted a product request: ${method} ${url}`);
}

/** Replaces `fetch` and `EventSource` for product paths. Calling it again does nothing. */
export function installNetworkGuard(): void {
  const scope = globalThis as Record<string, unknown>;
  if (scope[GUARD_FLAG]) return;
  scope[GUARD_FLAG] = true;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (isProductApi(url)) {
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      return Promise.reject(refuse(method.toUpperCase(), url));
    }
    return originalFetch(input, init);
  };

  const OriginalEventSource = globalThis.EventSource;
  if (OriginalEventSource) {
    class GuardedEventSource extends OriginalEventSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        if (isProductApi(String(url))) throw refuse('SSE', String(url));
        super(url, init);
      }
    }
    globalThis.EventSource = GuardedEventSource;
  }
}

/** Throws when a product request was attempted since the last call, and clears the record. */
export function assertNoProductRequests(): void {
  if (blockedRequests.length === 0) return;
  const attempts = blockedRequests.splice(0).join('\n');
  throw new Error(`Product requests were attempted by a story:\n${attempts}`);
}
