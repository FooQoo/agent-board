/**
 * The HTTP status a failure carries, if it came from a server: a failed read, a refused write, or
 * an error the data layer wrapped (the server's error is then the `cause` of what the cache holds).
 * `null` for anything else.
 */
export function httpStatusOf(error: unknown): number | null {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current instanceof Error; depth += 1) {
    const { status } = current as { status?: unknown };
    if (typeof status === 'number') return status;
    current = current.cause;
  }
  return null;
}
