import type { MockRequest, MockResponse } from '../mock-server/server.ts';

/** The body the sample-data server reads: text as it is, and the `metadata` field of a form. */
async function bodyText(request: Request): Promise<string> {
  if (request.method === 'GET' || request.method === 'HEAD') return '';
  const type = request.headers.get('content-type') ?? '';
  if (!type.startsWith('multipart/form-data')) return request.text();
  try {
    const metadata = (await request.formData()).get('metadata');
    return typeof metadata === 'string' ? metadata : '';
  } catch {
    return '';
  }
}

function headerRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, name) => {
    record[name.toLowerCase()] = value;
  });
  return record;
}

/** The sample-data server's view of `request`; `page` is the query of the page that sent it. */
export async function toMockRequest(request: Request, page: string): Promise<MockRequest> {
  const url = new URL(request.url);
  return {
    method: request.method.toUpperCase(),
    url: `${url.pathname}${url.search}`,
    page,
    headers: headerRecord(request.headers),
    body: await bodyText(request),
  };
}

/** A complete answer: the status, headers and body for `Response`; an empty one carries no body. */
export function toResponseInit(result: MockResponse): {
  body: string | null;
  init: ResponseInit;
} {
  const empty = result.status === 204 || result.status === 304 || result.body === '';
  return {
    body: empty ? null : result.body,
    init: { status: result.status, headers: result.headers },
  };
}
