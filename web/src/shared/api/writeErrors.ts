import type { Problem } from './contracts';

/** A rejected write returned by the server. */
export class WriteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly detail: string | null = null,
  ) {
    super(message);
  }
}

export const STALE_PAGE_EVENT = 'agboard:stale-page';

export function writeFailure(
  message: string,
  status: number,
  code: string | null,
  detail: string | null = null,
): WriteError {
  if (code === 'page_out_of_date') window.dispatchEvent(new Event(STALE_PAGE_EVENT));
  return new WriteError(message, status, code, detail);
}

/** Extract the invalid file and field from a `file_invalid` write response. */
export function problemOf(error: unknown): Problem | null {
  if (!(error instanceof WriteError) || error.code !== 'file_invalid') return null;
  const file = (error.detail ?? '').replace(/ is not valid\.$/, '');
  const reason = error.message;
  const separator = reason.indexOf(': ');
  if (separator === -1) return { file, field: '', reason };
  return { file, field: reason.slice(0, separator), reason: reason.slice(separator + 2) };
}
