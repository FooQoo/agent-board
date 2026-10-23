/** A ProjectId is 32 lowercase hexadecimal digits; anything else is not a project. */
export function isProjectIdValue(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{32}$/.test(value);
}

/**
 * The address the phone opens for one project: the public origin of the connection, the monitor
 * path, and the project in the query. The connection reports only the origin. Gives nothing
 * without a public address or without a ProjectId, so no QR code or copied URL is made then.
 */
export function phoneUrl(origin: string | null, projectId: string | null): string | null {
  if (!origin || !isProjectIdValue(projectId)) return null;
  const url = new URL(origin);
  url.pathname = '/monitor/';
  url.search = '';
  url.searchParams.set('project', projectId);
  return url.toString();
}
